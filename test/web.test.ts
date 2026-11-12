import request from "supertest";
import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

describe("sign-in and pages", () => {
  it("signs in as a demo user and shows their accounts", async () => {
    const { app } = demo();
    const signIn = await request(app).post("/sign-in").type("form").send({ userId: "U-LAILA" });
    expect(signIn.status).toBe(302);
    const cookie = String(signIn.headers["set-cookie"] ?? "");
    const home = await request(app).get("/home").set("Cookie", cookie);
    expect(home.status).toBe(200);
    expect(home.text).toContain("Current account");
    expect(home.text).toContain("Youssef Fathy");
  });

  it("sends a signed-out visitor to sign in, and the API answers 401", async () => {
    const { app } = demo();
    expect((await request(app).get("/home")).headers.location).toBe("/");
    expect((await request(app).get("/api/accounts")).status).toBe(401);
  });
});
