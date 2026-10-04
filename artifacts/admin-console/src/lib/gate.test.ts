import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { gateScreen, type Session } from "./gate";

/**
 * The gate decides what anybody who opens the console sees first, and both of
 * the mistakes it has made are pinned here: a server that was not answering
 * shown as "you are signed out", and a director shown the console's whole
 * navigation around an error before being told it was not theirs.
 */

const heather: Session = {
  user: { email: "heather@continuum.example", emailVerified: true },
};
const heatherOnDayOne: Session = {
  user: { email: "heather@continuum.example", emailVerified: false },
};

/** A question still out, or not asked yet: react-query calls both pending. */
const asking = { isPending: true, error: null, data: undefined };
const answered = <T>(data: T) => ({ isPending: false, error: null, data });
const failed = (status: number) => ({
  isPending: false,
  error: new ApiError(status, "words for a person"),
  data: undefined,
});

describe("the gate", () => {
  it("draws nothing while it is still asking who this is", () => {
    expect(gateScreen(asking, asking)).toEqual({ screen: "nothing" });
  });

  it("sends somebody who is signed out to the sign-in form", () => {
    expect(gateScreen(failed(401), asking)).toEqual({ screen: "sign-in" });
  });

  it("never shows the sign-in form because the server is down or the network dropped", () => {
    // Status 0 is the fetch wrapper's word for "could not reach the server".
    for (const status of [0, 500, 502, 503]) {
      expect(gateScreen(failed(status), asking)).toEqual({ screen: "error" });
    }
    const bug = { isPending: false, error: new Error("boom"), data: undefined };
    expect(gateScreen(bug, asking)).toEqual({ screen: "error" });
  });

  it("asks whether a signed-in account may come in before drawing any of the console", () => {
    expect(gateScreen(answered(heather), asking)).toEqual({ screen: "nothing" });
  });

  it("lets a platform admin in, under their own address", () => {
    expect(
      gateScreen(answered(heather), answered({ email: heather.user.email })),
    ).toEqual({ screen: "console", signedInAs: "heather@continuum.example" });
  });

  it("tells a director who followed a link that there is nothing here for them", () => {
    expect(gateScreen(answered(heather), failed(403))).toEqual({
      screen: "not-for-you",
      forbidden: true,
      unconfirmed: false,
    });
  });

  it("asks an account that has not confirmed its address to confirm it first", () => {
    // On the list but unconfirmed: how the platform's own owner meets this
    // screen on a fresh deployment.
    expect(gateScreen(answered(heatherOnDayOne), failed(403))).toEqual({
      screen: "not-for-you",
      forbidden: true,
      unconfirmed: true,
    });
  });

  it("offers to try again, rather than refusing, when the access question itself failed", () => {
    expect(gateScreen(answered(heather), failed(500))).toEqual({
      screen: "not-for-you",
      forbidden: false,
      unconfirmed: false,
    });
  });

  it("goes back to the sign-in form if the session ends between the two questions", () => {
    expect(gateScreen(answered(heather), failed(401))).toEqual({
      screen: "sign-in",
    });
  });
});
