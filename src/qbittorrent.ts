/**
 * A small client for the qBittorrent Web API.
 * It uses one endpoint only: the record of one torrent.
 *
 * Three authentication modes. Set QBIT_AUTH:
 *   "apikey"    the API key, in the Authorization header with the Bearer
 *               scheme. qBittorrent 5.2.0 and Web API 2.14.1 added this.
 *               There is no login call and no cookie.
 *   "password"  the user and the password. The answer holds a session
 *               cookie. Use this mode for a version before 5.2.0.
 *   "none"      no authentication. Use it if qBittorrent whitelists this IP
 *               ("Bypass authentication for clients in whitelisted subnets").
 *
 * Make a key here: qBittorrent > Options > Web UI > API keys > Generate.
 */
import { config } from "./config.js";
import { log } from "./log.js";

export interface Torrent {
  name: string;
  /** 0.0 to 1.0 */
  progress: number;
  /** The full path of the file or the folder, on the seedbox. */
  content_path: string;
  state: string;
}

export class QBittorrent {
  private cookie: string | null = null;

  constructor() {
    if (config.qbit.auth === "apikey" && !config.qbit.apiKey.startsWith("qbt_")) {
      log('WARNING: The API key does not start with "qbt_". Check the value.');
    }
  }

  /** The Authorization header, for the "apikey" mode. */
  private get extraHeaders(): Record<string, string> {
    if (config.qbit.auth !== "apikey") return {};
    return { Authorization: `Bearer ${config.qbit.apiKey}` };
  }

  private async login(): Promise<void> {
    if (config.qbit.auth !== "password") {
      // No login. The whitelist or the proxy does the work.
      this.cookie = null;
      return;
    }

    const body = new URLSearchParams({
      username: config.qbit.user,
      password: config.qbit.password,
    });

    const response = await fetch(`${config.qbit.url}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: config.qbit.url,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const text = (await response.text()).trim();
    if (!response.ok || text !== "Ok.") {
      throw new Error("The qBittorrent login failed. Check the user and the password.");
    }

    const cookies = response.headers.getSetCookie();
    const sid = cookies.find((value) => value.startsWith("SID="));
    if (sid === undefined) {
      // Some builds send no cookie when the client is on the whitelist.
      log("The qBittorrent answer has no session cookie. The requests go without one.");
      this.cookie = null;
      return;
    }
    this.cookie = sid.split(";")[0] ?? null;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { ...this.extraHeaders };
    if (this.cookie !== null) headers["Cookie"] = this.cookie;
    return headers;
  }

  /** Return the record of one torrent, or null if qBittorrent does not know it. */
  async info(hash: string): Promise<Torrent | null> {
    if (this.cookie === null && config.qbit.auth === "password") {
      await this.login();
    }

    const url = `${config.qbit.url}/api/v2/torrents/info?hashes=${hash.toLowerCase()}`;
    let response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });

    // The session can go old. Log in one more time and try again.
    if (
      (response.status === 401 || response.status === 403) &&
      config.qbit.auth === "password"
    ) {
      this.cookie = null;
      await this.login();
      response = await fetch(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30_000),
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `The qBittorrent API refused the request (status ${response.status}). ` +
          `The authentication mode is "${config.qbit.auth}". ` +
          `An API key needs qBittorrent 5.2.0 or later.`,
      );
    }

    if (!response.ok) {
      throw new Error(`The qBittorrent API answered with the status ${response.status}.`);
    }

    const records = (await response.json()) as Torrent[];
    return records[0] ?? null;
  }
}
