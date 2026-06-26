import { describe, it, expect } from "bun:test";
import { ToolBuilder } from "../src/tool-builder.js";

describe("ToolBuilder.create", () => {
  it("is the documented fluent entry point, equivalent to the constructor", () => {
    const viaStatic = ToolBuilder.create("get_weather")
      .description("Get the weather for a city")
      .param("city", "string", "City name", { required: true })
      .build();

    expect(viaStatic.definition.name).toBe("get_weather");
    expect(viaStatic.definition.description).toBe("Get the weather for a city");
    expect(viaStatic.definition.parameters[0]).toMatchObject({
      name: "city",
      type: "string",
      required: true,
    });
  });

  it("static create and `new` produce equivalent definitions", () => {
    const a = ToolBuilder.create("x").description("d").build();
    const b = new ToolBuilder("x").description("d").build();
    expect(a.definition).toEqual(b.definition);
  });
});
