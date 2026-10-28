# cc-stream-macos-fanout-io

Cribl Stream pack that derives native metrics from macOS Edge events. It emits
four metrics: launchd spawns, process exec starts, app bundle launches, and the
largest WindowServer monitor loop gap per window.

## Installation

The pack ships no sources. It is attached to a Stream source by pipeline id: a
connection that names `pack:cc-stream-macos-fanout-io` routes events through its
routes. `make build` writes the `.crbl` artifact.

## Usage

```sh
make install     # Node test dependencies (pnpm)
make docker-up   # Cribl test container
make test        # Vitest: route and pipeline fixtures, metric contract
make lint        # Biome check
make build       # .crbl artifact
```

## Routes and metrics

| Route | Filter | Pipeline | Metric | Type | Dimensions |
| --- | --- | --- | --- | --- | --- |
| `process_exec_starts` | `event_type=='exec'` | `macos_process_starts` | `macos_process_starts_total` | counter | `host`, `exe` |
| `process_app_checkins` | `sourcetype=='macos:process:lifecycle'` | `macos_app_checkins` | `macos_app_checkins_total` | counter | `host`, `app` |
| `launchd_spawns` | `sourcetype=='macos:unified_log'` | `macos_launchd_spawns` | `macos_launchd_spawns_total` | counter | `host`, `label` |
| `ws_monitor_gap` | `sourcetype=='ws-monitor'` | `macos_ws_monitor_gap` | `ws_monitor_gap_seconds` | gauge | `host` |

## Behavior

- `exe` is the basename of `exe_path`.
- `app` is the `<Name>.app` bundle name parsed from `exe_path`. Only exec events
  whose path sits inside `.app/Contents/MacOS/` count. Other lifecycle events
  produce rows with an empty `app` and a zero count.
- `label` is the service label in a `Successfully spawned <label>[<pid>]` line.
  Other unified-log lines produce rows with an empty `label` and a zero count.
- `ws_monitor_gap_seconds` is the maximum `gap_s` per host in each window.
- Each pipeline aggregates every event on its route in 60 s windows. It emits
  aggregates only; original events do not pass through.
- `process_exec_starts` is non-final, so exec events continue to
  `process_app_checkins`, which consumes them.
- The pack has no catch-all route. Events that match no route are not handled by
  its pipelines.
- The pack ships no sources and sets no destinations. Connections attach these
  routes by pipeline id.

## Tests

`tests/fixtures/<pipeline>/<case>.json` holds input events, and
`<case>.expected.json` holds the expected output fields. The metric contract
test pins metric names, types, dimensions, and route order.
