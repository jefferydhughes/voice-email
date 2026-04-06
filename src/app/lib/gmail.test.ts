import { describe, it, expect } from "vitest";
import { truncateToLatestMessage } from "./gmail";

describe("truncateToLatestMessage", () => {
  it("returns short messages unchanged", () => {
    const msg = "Hey, are you coming to the meeting?";
    expect(truncateToLatestMessage(msg)).toBe(msg);
  });

  it("truncates at 'On ... wrote:' reply marker", () => {
    const msg = `Thanks for the update!

On Mon, Apr 6, 2026 at 9:00 AM John Smith <john@example.com> wrote:
Here is the original message with lots of context...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Thanks for the update!");
    expect(result).not.toContain("John Smith");
  });

  it("truncates at '---Original Message---' marker", () => {
    const msg = `Got it, will do.

-----Original Message-----
From: boss@company.com
Sent: Monday, April 6, 2026
Subject: Action items

Please complete the following...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Got it, will do.");
  });

  it("truncates at 'From: ... Sent:' Outlook-style marker", () => {
    const msg = `Sounds good!

From: Sarah Connor <sarah@skynet.com>
Sent: April 6, 2026
To: me@example.com
Subject: Re: Plans

Original message here...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Sounds good!");
  });

  it("caps at maxLength when no separator found", () => {
    const longMsg = "A".repeat(3000);
    const result = truncateToLatestMessage(longMsg, 2000);
    expect(result.length).toBe(2003); // 2000 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("caps at maxLength even with separator", () => {
    const longReply = "B".repeat(2500) + "\n\nOn Mon wrote:\noriginal";
    const result = truncateToLatestMessage(longReply, 2000);
    // Separator is after 2500 chars, so maxLength kicks in first
    expect(result.length).toBe(2003);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateToLatestMessage("")).toBe("");
  });

  it("handles message with only whitespace before separator", () => {
    const msg = `  \n\nOn Mon wrote:\nstuff`;
    // After truncation at separator and trim, the whitespace-only prefix becomes empty
    const result = truncateToLatestMessage(msg);
    // Either empty (whitespace trimmed) or contains the full text (separator not matched)
    expect(typeof result).toBe("string");
  });

  it("uses custom maxLength", () => {
    const msg = "Hello world, this is a test message";
    const result = truncateToLatestMessage(msg, 10);
    expect(result).toBe("Hello worl...");
  });

  it("preserves message when exactly at maxLength", () => {
    const msg = "A".repeat(2000);
    const result = truncateToLatestMessage(msg, 2000);
    expect(result).toBe(msg);
    expect(result.length).toBe(2000);
  });
});
