import assert from "node:assert/strict";
import { it } from "node:test";
import { createCapacityGuard, createRequestAdmission, createStorageCircuit } from "../case-data/gateway-controls.mjs";

it("rejects both per-client and overall overload without queueing", () => {
  const admit = createRequestAdmission(2, 1);
  const first = admit("author");
  assert.equal(admit("author").status, 429);
  const second = admit("media");
  assert.equal(admit("public").status, 503);
  first.release();
  const third = admit("public");
  assert.equal(typeof third.release, "function");
  second.release();
  third.release();
});

it("uses the highest configured capacity and preserves reads and withdrawal", async () => {
  let now = 0;
  let used = 75;
  let calls = 0;
  const changes = [];
  const check = createCapacityGuard({ locations: '["/database","/objects"]', warning: 75, stopUploads: 85, stopWrites: 90 }, {
    clock: () => now, notify: (event) => changes.push(event),
    sample: async (path) => {
      calls += 1;
      if (used === null) throw new Error("unmounted");
      return { blocks: 100n, bavail: BigInt(path === "/database" ? 50 : 100 - used) };
    },
  });
  assert.deepEqual(await Promise.all([check("upload"), check("write")]), [null, null]);
  assert.equal(calls, 2);
  assert.deepEqual(changes.at(-1), { event: "case_capacity_changed", level: "warning", percent: 75 });
  now += 1000;
  used = 85;
  assert.equal(await check("upload"), "CAPACITY_UPLOAD_PAUSED");
  assert.equal(await check("write"), null);
  now += 1000;
  used = 90;
  assert.equal(await check("upload"), "CAPACITY_READ_ONLY");
  assert.equal(await check("write"), "CAPACITY_READ_ONLY");
  assert.equal(await check("read"), null);
  assert.equal(await check("withdraw"), null);
  now += 1000;
  used = null;
  assert.equal(await check("upload"), "CAPACITY_UNAVAILABLE");
  now += 1000;
  used = 40;
  assert.equal(await check("upload"), null);
  assert.equal(changes.at(-1).level, "normal");
});

it("fails fast after consecutive storage failures and admits one recovery probe", () => {
  let now = 100;
  const admit = createStorageCircuit(() => now);
  const stale = admit();
  for (let attempt = 0; attempt < 3; attempt += 1) admit()(false);
  stale(true);
  assert.equal(admit(), null);
  now += 5000;
  const failedProbe = admit();
  assert.equal(admit(), null);
  failedProbe(false);
  assert.equal(admit(), null);
  now += 5000;
  admit()(true);
  assert.equal(typeof admit(), "function");
});
