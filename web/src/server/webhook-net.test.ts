import { describe, expect, it } from "vitest";
import {
  isBlockedAddress,
  parseWebhookUrl,
  resolveSafeAddress,
  safePost,
  WebhookSendError,
} from "@/server/webhook-net";

describe("parseWebhookUrl", () => {
  it("accepts a plain https URL on the default port, with a path and query", () => {
    expect(parseWebhookUrl("https://hooks.example.com/in/abc?x=1").toString()).toBe(
      "https://hooks.example.com/in/abc?x=1"
    );
    expect(parseWebhookUrl("https://example.com:443/hook").port).toBe("");
  });

  it.each([
    ["http://example.com/hook", "http"],
    ["ftp://example.com/hook", "another scheme"],
    ["https://user:pass@example.com/hook", "credentials"],
    ["https://user@example.com/hook", "a user name"],
    ["https://example.com/hook#frag", "a fragment"],
    ["https://example.com:8443/hook", "another port"],
    ["https://example.com:80/hook", "port 80"],
    ["https://127.0.0.1/hook", "an IPv4 literal"],
    ["https://[::1]/hook", "an IPv6 literal"],
    ["https://[::ffff:127.0.0.1]/hook", "a mapped IPv4 literal"],
    ["https://2130706433/hook", "a decimal IPv4 literal"],
    ["https://0x7f.1/hook", "a hex IPv4 literal"],
    ["https://localhost/hook", "a single-label name"],
    ["not a url", "garbage"],
    [`https://example.com/${"a".repeat(600)}`, "an overly long URL"],
  ])("refuses %s (%s)", (raw) => {
    expect(() => parseWebhookUrl(raw)).toThrow();
  });
});

describe("isBlockedAddress", () => {
  it("lets ordinary public addresses through", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it.each([
    // private
    ["10.0.0.1"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.0.1"],
    // loopback and "this network"
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["0.0.0.0"],
    // link-local and cloud metadata
    ["169.254.0.1"],
    ["169.254.169.254"],
    ["192.0.0.192"],
    ["100.100.100.200"],
    // carrier-grade NAT 100.64.0.0/10
    ["100.64.0.0"],
    ["100.127.255.255"],
    // multicast, reserved and broadcast
    ["224.0.0.1"],
    ["239.255.255.250"],
    ["240.0.0.1"],
    ["255.255.255.255"],
  ])("blocks IPv4 %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ["::1"],
    ["::"],
    ["fe80::1"],
    ["febf::1"],
    ["fc00::1"],
    ["fd00:ec2::254"],
    ["fdff:ffff::1"],
    ["ff02::1"],
    ["ff05::1:3"],
    // IPv4 hidden inside IPv6: mapped (dotted and hex), compatible, NAT64, 6to4
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:169.254.169.254"],
    ["::ffff:a9fe:a9fe"],
    ["::ffff:10.0.0.1"],
    ["::ffff:100.64.0.1"],
    ["::127.0.0.1"],
    ["64:ff9b::7f00:1"],
    ["2002:7f00:1::"],
    ["2002:a9fe:a9fe::"],
  ])("blocks IPv6 %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it("blocks anything that is not an address", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("resolveSafeAddress", () => {
  const lookupOf = (...addresses: string[]) => async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("returns the checked address to connect to", async () => {
    await expect(resolveSafeAddress("hooks.example.com", lookupOf("93.184.216.34"))).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    await expect(resolveSafeAddress("hooks.example.com", lookupOf("2606:4700::1"))).resolves.toEqual({
      address: "2606:4700::1",
      family: 6,
    });
  });

  it("refuses when any answer is internal, so a mixed answer cannot slip through", async () => {
    const err = await resolveSafeAddress("evil.example.com", lookupOf("93.184.216.34", "127.0.0.1")).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookSendError);
    expect(err.code).toBe("blocked_address");
  });

  it("refuses a metadata address behind a public-looking name", async () => {
    const err = await resolveSafeAddress("meta.example.com", lookupOf("169.254.169.254")).catch((e) => e);
    expect(err.code).toBe("blocked_address");
  });

  it("reports a name that does not resolve", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    expect((await resolveSafeAddress("nope.example.com", failing).catch((e) => e)).code).toBe("dns_failed");
    expect((await resolveSafeAddress("empty.example.com", lookupOf()).catch((e) => e)).code).toBe("dns_failed");
  });

  it("never resolves an IP literal", async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return [{ address: "8.8.8.8", family: 4 }];
    };
    expect((await resolveSafeAddress("8.8.8.8", spy).catch((e) => e)).code).toBe("blocked_address");
    expect(called).toBe(false);
  });
});

describe("safePost", () => {
  const url = new URL("https://hooks.example.com/in/abc");

  it("times out a DNS lookup that never resolves instead of waiting on the OS resolver", async () => {
    let transportCalled = false;
    const err = await safePost(
      url,
      {},
      "{}",
      {
        lookup: () => new Promise<never>(() => {}),
        transport: async () => {
          transportCalled = true;
          return { status: 200 };
        },
        timeoutMs: 20,
      }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookSendError);
    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(transportCalled).toBe(false);
  });

  it("passes the budget left after resolution to the transport", async () => {
    let budget: number | undefined;
    const result = await safePost(url, {}, "{}", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async (req) => {
        budget = req.timeoutMs;
        return { status: 204 };
      },
      timeoutMs: 1000,
    });
    expect(result).toEqual({ status: 204 });
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(1000);
  });
});
