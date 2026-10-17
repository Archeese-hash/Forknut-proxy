import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedHostname, isPublicAddress } from "../lib/security.js";

test("blocks local and special hostnames", () => {
  for (const host of ["localhost", "printer.local", "service.internal", "host.test", "host.invalid"]) {
    assert.equal(isBlockedHostname(host), true, host);
  }
  assert.equal(isBlockedHostname("example.com"), false);
});

test("rejects non-public IPv4 ranges", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.51.100.2", "203.0.113.9", "224.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("only accepts globally routable IPv6 unicast", () => {
  for (const address of ["::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
