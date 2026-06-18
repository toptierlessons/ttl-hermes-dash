# TTL-Hermes

Thin web-app layer on top of the Hermes dashboard targeted towards non-technical users. Not for production use.

## How to Use

- Install Hermes as usual and enable the web dashboard in gated mode [(more information here)](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#usernamepassword-provider-no-oauth-idp)
- `git clone https://github.com/toptierlessons/ttl-hermes-dash.git`
- `cd ttl-hermes-dash`
- Install dependencies `pnpm install`
- Build dist using `pnpm build`
- Have a [Caddy Server](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) serve the built SPA publicly over HTTPS while the Hermes backend stays private on the box. Caddy is the only public entry point; Hermes listens on a loopback-only address and enforces gated-mode auth.