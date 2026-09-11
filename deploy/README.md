# Production deployment with Caddy + Let's Encrypt

This version intentionally removes TLS handling from Node.js. Node listens only on
127.0.0.1:3000. Caddy is the public HTTPS endpoint and reverse proxy.

Caddy automatically obtains and renews publicly trusted certificates for a real
domain and redirects HTTP to HTTPS when DNS and ports 80/443 are correctly set.

## 1. DNS

Point your domain's A record to the server's public IPv4 address.
If using IPv6, point AAAA to the server's IPv6 address.

Example:

    example.com -> YOUR_SERVER_IP

Do not use `localhost` or a private IP as the public domain.

## 2. Firewall

Allow only SSH plus web traffic:

    sudo ufw allow OpenSSH
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw enable

Do NOT expose port 3000 publicly.

## 3. Install Node.js and Caddy

Install Node.js 20+ and Caddy using the official packages for your Linux
distribution. Verify:

    node --version
    caddy version

## 4. Install the application

Example:

    sudo mkdir -p /opt/job-application-site
    sudo cp -R . /opt/job-application-site/

Create a dedicated user:

    sudo useradd --system --home /opt/job-application-site --shell /usr/sbin/nologin jobapp
    sudo chown -R jobapp:jobapp /opt/job-application-site

Install dependencies:

    cd /opt/job-application-site
    sudo -u jobapp npm ci

## 5. Configure secrets

Copy the example:

    sudo cp deploy/job-application-site.env.example /etc/job-application-site.env
    sudo nano /etc/job-application-site.env

Set:

    NODE_ENV=production
    PORT=3000
    HOST=127.0.0.1
    ADMIN_PASSWORD=...
    SESSION_SECRET=...
    DOMAIN=your-real-domain.example

Use long random values for ADMIN_PASSWORD and SESSION_SECRET.

Protect the environment file:

    sudo chmod 600 /etc/job-application-site.env
    sudo chown root:root /etc/job-application-site.env

## 6. Start Node with systemd

    sudo cp deploy/job-application-site.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now job-application-site
    sudo systemctl status job-application-site

The backend should be reachable only locally:

    curl http://127.0.0.1:3000

## 7. Configure Caddy

Edit Caddyfile and replace `{$DOMAIN}` through the environment used by Caddy,
or use the concrete domain directly. The simplest production setup is to put
the real domain in the file, e.g.:

    example.com {
        encode gzip zstd
        reverse_proxy 127.0.0.1:3000
    }

Copy it:

    sudo cp Caddyfile /etc/caddy/Caddyfile

Validate:

    sudo caddy validate --config /etc/caddy/Caddyfile

Reload:

    sudo systemctl reload caddy

Caddy will obtain the public certificate and keep it renewed automatically.

## 8. Test

Open:

    https://your-real-domain.example

Admin:

    https://your-real-domain.example/admin

HTTP should redirect to HTTPS.

## Important

- Never expose port 3000 to the Internet.
- Never commit `.env` files, session database files, SQLite application data,
  or private keys to Git.
- Back up `applications.db` and `sessions.sqlite` securely.
- Use a real public DNS name and make sure ports 80 and 443 reach Caddy.
