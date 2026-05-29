import assert from "node:assert/strict";
import test from "node:test";
import { getModel, resolveModelIdForUser } from "./models.ts";
import { DEFAULT_AI_MODEL } from "../constants.ts";

test("resolveModelIdForUser falls back when the request omits a model", () => {
  const previousLocalDev = process.env.LOCAL_DEV;
  process.env.LOCAL_DEV = "false";

  try {
    assert.equal(
      resolveModelIdForUser(undefined, "learner@example.com"),
      DEFAULT_AI_MODEL,
    );
  } finally {
    process.env.LOCAL_DEV = previousLocalDev;
  }
});

test("resolveModelIdForUser rejects stringified undefined model ids", () => {
  const previousLocalDev = process.env.LOCAL_DEV;
  process.env.LOCAL_DEV = "false";

  try {
    assert.equal(
      resolveModelIdForUser("undefined", "learner@example.com"),
      DEFAULT_AI_MODEL,
    );
  } finally {
    process.env.LOCAL_DEV = previousLocalDev;
  }
});

test("getModel falls back instead of building an undefined provider id", () => {
  const previousLocalDev = process.env.LOCAL_DEV;
  process.env.LOCAL_DEV = "false";

  try {
    assert.doesNotThrow(() => getModel(undefined));
    assert.doesNotThrow(() => getModel("undefined"));
  } finally {
    process.env.LOCAL_DEV = previousLocalDev;
  }
});
