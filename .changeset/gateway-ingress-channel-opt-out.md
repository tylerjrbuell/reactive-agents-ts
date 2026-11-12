---
"@reactive-agents/runtime": patch
---

`withGateway({ ingress: { channels } })` controls which webhook-capable channel adapters the framework ingress serves at `/channels/<id>`. The default is unchanged (serve all); `false` serves none and an id list serves only those, for hosts that mount an adapter on their own listener. A bind failure of the framework ingress is now logged at warn with the port and reason (it was logged as error without the port).
