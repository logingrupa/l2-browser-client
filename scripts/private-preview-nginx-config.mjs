import path from 'node:path';

export const devServerPort = 5173;
export const privatePreviewModes = ['static', 'dev'];
export const slash = (value) => value.replaceAll('\\', '/');

const windowsNginxSelectConnectionLimit = 1024;

const responseHeaders = `add_header Cache-Control "private, no-store" always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;`;

function staticServerBody(distDirectory) {
  return `root "${slash(distDirectory)}";
    index index.html;
    autoindex off;
    absolute_redirect off;`;
}

const staticContentLocations = `location ~ (^|/)\\. { return 404; }
    location ~* \\.(map|ts|tsx|jsx|mjs|cjs)$ { return 404; }
    location / { try_files $uri $uri/ =404; }`;

const devProxyLocation = `location / {
      proxy_pass http://127.0.0.1:${devServerPort};
      proxy_http_version 1.1;
      proxy_set_header Host 127.0.0.1:${devServerPort};
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_read_timeout 3600s;
      proxy_buffering off;
    }`;

const webSocketUpgradeMap = 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }';

export function buildPrivatePreviewNginxConfig({ key, mode, pidFile, directory, nginxExecutable, distDirectory, cookieName, hostname, port }) {
  if (!privatePreviewModes.includes(mode)) throw Error(`Unknown private preview mode: ${mode}`);
  const isDevMode = mode === 'dev';
  return `worker_processes 1;
pid "${slash(pidFile)}";
error_log "${slash(directory)}/origin-error.log" warn;
events { worker_connections ${windowsNginxSelectConnectionLimit}; }
http {
  include "${path.posix.dirname(nginxExecutable)}/conf/mime.types";
  default_type application/octet-stream;
  access_log off;
  server_tokens off;
  client_body_temp_path "${slash(directory)}/temp";
  map $http_cookie $preview_cookie_ok { default 0; "~(?:^|;[ ]*)${cookieName}=${key}(?:;|$)" 1; }
  map $arg_key $preview_key_ok { default 0; ~^${key}$ 1; }
  map "$preview_key_ok:$request_method" $preview_set_cookie {
    default "";
    "1:GET" "${cookieName}=${key}; Path=/; Secure; HttpOnly; SameSite=Lax";
    "1:HEAD" "${cookieName}=${key}; Path=/; Secure; HttpOnly; SameSite=Lax";
  }
  map "$preview_cookie_ok:$preview_key_ok:$uri" $preview_allowed {
    default 0;
    ~^1: 1;
    "0:1:/enter" 1;
  }
  ${isDevMode ? webSocketUpgradeMap : ''}
  server {
    listen 127.0.0.1:${port} default_server backlog=1024;
    server_name ${hostname};
    ${isDevMode ? 'absolute_redirect off;' : staticServerBody(distDirectory)}
    if ($request_method !~ ^(GET|HEAD)$) { return 403; }
    if ($preview_allowed = 0) { return 403; }
    ${responseHeaders}
    location = /enter {
      if ($preview_key_ok = 0) { return 403; }
      add_header Set-Cookie $preview_set_cookie always;
      ${responseHeaders}
      return 303 "/?authored=1";
    }
    ${isDevMode ? devProxyLocation : staticContentLocations}
  }
}
`;
}
