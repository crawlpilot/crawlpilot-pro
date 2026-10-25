# src/pro

Code that exists only in CrawlPilot Pro lives here: its recipe and version stores (`db/`), its screens (`pages/`)
and the backend client.

Everything outside this folder comes from the public extension and is merged in from upstream. Changes there are
kept to small hook points (a route in `App.tsx`, a "Save version" button in place of "Run"), so each upstream merge
conflicts in as few lines as possible.
