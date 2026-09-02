# WebSocket Diagnostics

HeySnap emits structured websocket lifecycle logs through Pino. When `AXIOM_TOKEN`
is present, the same logs are also sent to Axiom.

## Axiom Dataset

The diagnostic dataset is:

```text
heysnap-websocket-logs
```

It was created with:

```sh
axiom dataset create --name heysnap-websocket-logs --description "HeySnap websocket tunnel and connection lifecycle logs"
```

## Runtime Environment

Set these on both the cloud server and machine server:

```sh
AXIOM_DATASET=heysnap-websocket-logs
AXIOM_TOKEN=...
AXIOM_ORG_ID=...
LOG_LEVEL=info
```

The Axiom CLI can export the authenticated values locally:

```sh
eval "$(axiom config export -f)"
export AXIOM_DATASET=heysnap-websocket-logs
```

Without `AXIOM_TOKEN`, logs still go to stdout as Pino JSON.

## Useful Queries

Recent disconnects:

```apl
['heysnap-websocket-logs']
| where event in (
  "machine_tunnel.close",
  "machine_tunnel_client.close",
  "gateway_ws.close",
  "filesystem_ws.close",
  "browser_control_ws.close",
  "client.diagnostic"
)
| sort by _time desc
| limit 100
```

A single computer:

```apl
['heysnap-websocket-logs']
| where computerId == "cmp_..."
| sort by _time desc
| limit 200
```

Access-session refresh churn:

```apl
['heysnap-websocket-logs']
| where clientEvent startswith "cloud.access_session"
   or clientEvent == "workspace.websocket_url_changed"
| sort by _time desc
| limit 100
```

Machine restarts/update suspicion:

```apl
['heysnap-websocket-logs']
| where event == "machine.heartbeat"
| project _time, computerId, safeToRestart, safeToSleep, activeSessions, updateState, lastUpdateError
| sort by _time desc
| limit 100
```
