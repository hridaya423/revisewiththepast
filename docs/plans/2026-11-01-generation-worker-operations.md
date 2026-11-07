# Generation worker activation

The builder now queues durable jobs in Convex. A Next.js request does not run the PDF generator. A separate Node process claims work and stores the files.

## Activation boundary

This change has not been deployed or run against a real generation queue. Do not activate it against production incidentally. The existing frozen deployment must be resolved by its owner first.

Deploy the application, Convex functions/schema and worker from the same revision. Existing shadow-paper functions, indexes and cron registrations must remain intact.

## Worker runtime

Use the repository's supported Node runtime with the native `@napi-rs/canvas` package for that host. The worker needs the full source tree, `tsx`, PDF.js font/WASM assets, project fonts and access to the configured question/source assets. A standalone Next.js server bundle alone is not a worker image.

The current command uses a development dependency. Install with `npm ci --include=dev` in a dedicated worker image, or package a separate verified worker build before omitting development dependencies. Do not assume `npm ci --omit=dev` includes `tsx`.

Supply the same Convex URL and service-secret configuration as the application. Keep secrets in the service's secret store, not commands, logs or checked-in files. The entry point loads the Next environment files when running locally.

Check the runtime without reading or changing queue data:

```sh
npm run worker:generation -- --check
```

Start the service under a supervisor that restarts it after failure:

```sh
npm run worker:generation
```

Run one or more instances according to measured memory/CPU requirements. Each instance processes one job at a time; leases prevent another instance checkpointing that job. Give graceful shutdown enough time for a current paper to finish. An abruptly terminated process leaves a lease that another worker can reclaim after 90 seconds.

The worker checks in while idle and renews its presence while working. New requests return a recoverable 503, without reserving quota, when no worker has checked in within 90 seconds. Already accepted jobs remain stored and can resume when an executor returns.

## Required private-environment proving run

Use an authorised private deployment and original/permitted sample content:

1. Start the worker, create one paper and confirm the real PDF and first-page PNG exist behind the authenticated/capability download boundary.
2. Start a multi-paper job. Record its job URL and the first completed paper's hash.
3. Stop the worker after that paper is checkpointed. Refresh/navigate away and return to the same preparation.
4. Restart after lease expiry. Confirm completed paper identity/hash is unchanged, later papers resume and only one generation allowance was reserved.
5. Fail a scheme fetch in the isolated worker. Confirm the question paper remains downloadable; retry only the scheme and verify the question PDF hash remains unchanged.
6. Repeat a retry request and send a cancellation from its previous run version. Confirm no duplicate reservation or cancellation of the newer retry.
7. Check a second worker cannot checkpoint the first worker's lease. Confirm successful/cancelled terminal states resist late writes.
8. Claim a guest paper after sign-in. Verify the former guest capability and a second account cannot read it, including by replaying its request key.
9. Save and reopen the paper. Confirm the stored saved copy survives preparation-link expiry.

Handler and browser fixtures do not substitute for this run. No hosted-persistence, restart or throughput claim is made until these checks are recorded.

## Storage and observability

Preparation links expire after 24 hours. A cron removes expired job records and referenced preparation artifacts in bounded batches; saved-paper copies are separate. Do not manually delete or truncate tables as part of activation.

Monitor queue age, stale worker presence, exhausted attempts, storage failures and expired-record cleanup backlog. Inspect Convex request diagnostics without logging secrets or student content. Validate batch/cron capacity against measured volume before a national-scale claim.

Cancellation takes effect at a checkpoint boundary. A question paper that finished before cancellation can remain downloadable. It is not proof that every requested mark scheme or combined pack exists; the interface follows actual artifact state.
