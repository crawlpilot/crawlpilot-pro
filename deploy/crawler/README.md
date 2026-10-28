# Deploying the crawler worker

The worker (`src/pro/crawler`, design in `docs/design/crawler.md`) runs as an ECS service on Fargate, taking jobs from
SQS and writing to Elasticsearch. The files here are templates: replace `{{ACCOUNT_ID}}`, `{{REGION}}` and `{{TAG}}`.

| File | What it is |
| --- | --- |
| `Dockerfile` | The image: the worker bundle on Microsoft's Playwright image (Chromium included), as `pwuser` |
| `package.json` | What the image installs at runtime, pinned to the repository's lock file (checked by a unit test) |
| `ecs-task-definition.json` | The Fargate task: 2 vCPU, 4 GB, init process, 120 s to finish jobs on stop, secrets from Secrets Manager and SSM |
| `iam-task-policy.json` | The task role's permissions: the jobs queue and the dead-letter queue, nothing else |

## 1. Queues
Two standard queues: `crawlpilot-crawl-jobs` (visibility timeout 10 minutes, the worker's `visibilitySeconds`) and
`crawlpilot-crawl-dead`. The worker dead-letters itself, with the reason; also give the jobs queue a redrive policy to
the dead-letter queue (`maxReceiveCount` 5) for jobs whose worker died mid-run more than once.

## 2. Configuration and secrets
The configuration (`src/pro/crawler/crawler.example.json` as a start) goes in the SSM parameter
`/crawlpilot/crawler/config`, with the queue:
```json
"queue": { "type": "sqs", "url": "https://sqs.{{REGION}}.amazonaws.com/{{ACCOUNT_ID}}/crawlpilot-crawl-jobs",
           "deadLetterUrl": "https://sqs.{{REGION}}.amazonaws.com/{{ACCOUNT_ID}}/crawlpilot-crawl-dead",
           "waitSeconds": 10, "visibilitySeconds": 600 }
```
Every `${NAME}` in it is read from the environment: put those values in the Secrets Manager secret
`crawlpilot/crawler` and list them under `secrets` in the task definition. `concurrency` is pages at once per task;
start at 4 for 2 vCPU and 4 GB, and tune it on the task's CPU and memory.

## 3. Image
```
docker build -f deploy/crawler/Dockerfile -t crawlpilot-crawler:$TAG .
docker tag crawlpilot-crawler:$TAG {{ACCOUNT_ID}}.dkr.ecr.{{REGION}}.amazonaws.com/crawlpilot-crawler:$TAG
docker push {{ACCOUNT_ID}}.dkr.ecr.{{REGION}}.amazonaws.com/crawlpilot-crawler:$TAG
```
Behind a proxy that re-signs TLS, add `--secret id=ca,src=<its CA file>` and the proxy as `--build-arg HTTPS_PROXY=…`.

The image is about 3.5 GB: Playwright's image carries Firefox and WebKit too. A slimmer one (Node's slim image plus
`npx playwright install --with-deps --only-shell chromium`, about 1 GB) starts tasks faster; it needs `apt` access to
Debian's mirrors at build time, which the environment this was built in did not have, so it is not the default yet.

## 4. Elasticsearch, once
```
aws ecs run-task --cluster crawlpilot --launch-type FARGATE --task-definition crawlpilot-crawler \
  --network-configuration '…' --overrides '{"containerOverrides":[{"name":"crawler","command":["--setup-elasticsearch"]}]}'
```

## 5. The service
An ECS service of the task definition, in private subnets with a NAT gateway (or the proxies) for egress. Scale on
queue depth with Application Auto Scaling: target tracking on `ApproximateNumberOfMessagesVisible` per task (for example
200), between 1 and the number of tasks your proxies and sites can take. Stopping a task (a deploy, a scale-in) sends
SIGTERM: the worker takes no new jobs, finishes the ones in flight within `stopTimeout`, and flushes Elasticsearch;
jobs it had not started come back to the queue when their visibility ends.

A wedged task (jobs in flight, none settled for 15 minutes) stops writing its heartbeat file; the task
definition's health check then fails it and ECS starts another. A task whose browser fails five times in a row
exits on its own.

## 6. Daily rollup
An EventBridge Scheduler schedule at 00:30 UTC, target ECS `RunTask` of the same task definition with the command
`["--rollup"]` (yesterday's selector usage into `selector-usage-daily-YYYY`). Rerunning a day replaces its totals.

## What to watch
In Elasticsearch: `crawl-requests-*` by `errorClass`, `outcome` and `host` (block rates per site, proxy errors per
`proxyId`), `crawl-sites-*` for sites going `blocked`, and the dead-letter queue's depth.
