/**
 * The path map. Three folders show the same data:
 *
 *   qBittorrent (seedbox)   /downloads/movies/Film.2024      QBIT_ROOT
 *   SFTP server (seedbox)   /uploads/movies/Film.2024        REMOTE_DIR
 *   this container          /downloads/movies/Film.2024      LOCAL_ROOT
 *   the Radarr container    /data/downloads/movies/Film.2024 the path mapping
 *
 * This program keeps the part after the root. The Radarr remote path
 * mapping then finds the film.
 */
import path from "node:path";
import { config } from "./config.js";
import type { Torrent } from "./qbittorrent.js";

export interface MappedPaths {
  relative: string;
  remote: string;
  local: string;
}

export function mapPaths(torrent: Torrent): MappedPaths | null {
  const content = torrent.content_path ?? "";
  let relative: string;

  if (content.startsWith(`${config.qbit.root}/`)) {
    relative = content.slice(config.qbit.root.length + 1);
  } else {
    // The prefix does not match. The torrent name is the fallback.
    relative = torrent.name ?? "";
  }

  relative = relative.replace(/^\/+|\/+$/g, "");
  if (relative === "") return null;

  // A remote name with ".." cannot leave the local root.
  const local = path.resolve(config.localRoot, relative);
  if (!local.startsWith(path.resolve(config.localRoot) + path.sep)) return null;

  return {
    relative,
    remote: `${config.sftp.remoteDir}/${relative}`,
    local,
  };
}
