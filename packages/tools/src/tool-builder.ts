import type { ToolDefinition, ToolParameter } from "./types.js";

export class ToolBuilder {
  private _name: string;
  private _description?: string;
  private _parameters: ToolParameter[] = [];
  private _riskLevel: ToolDefinition["riskLevel"] = "low";
  private _timeoutMs = 30_000;
  private _requiresApproval = false;
  private _returnType?: string;
  private _category?: ToolDefinition["category"];
  private _handler?: (...args: unknown[]) => unknown;

  constructor(name: string) {
    this._name = name;
  }

  description(desc: string): this {
    this._description = desc;
    return this;
  }

  param(
    name: string,
    type: ToolParameter["type"],
    description: string,
    options?: { required?: boolean; default?: unknown; enum?: string[] }
  ): this {
    this._parameters.push({
      name,
      type,
      description,
      required: options?.required ?? false,
      ...(options?.default !== undefined ? { default: options.default } : {}),
      ...(options?.enum ? { enum: options.enum } : {}),
    } as ToolParameter);
    return this;
  }

  riskLevel(level: ToolDefinition["riskLevel"]): this {
    this._riskLevel = level;
    return this;
  }

  timeout(ms: number): this {
    this._timeoutMs = ms;
    return this;
  }

  requiresApproval(val = true): this {
    this._requiresApproval = val;
    return this;
  }

  returnType(type: string): this {
    this._returnType = type;
    return this;
  }

  category(cat: ToolDefinition["category"]): this {
    this._category = cat;
    return this;
  }

  handler(fn: (...args: unknown[]) => unknown): this {
    this._handler = fn;
    return this;
  }

  build(): { definition: ToolDefinition; handler?: (...args: unknown[]) => unknown } {
    if (!this._description) {
      throw new Error("ToolBuilder: description is required");
    }
    const definition: ToolDefinition = {
      name: this._name,
      description: this._description,
      parameters: this._parameters,
      riskLevel: this._riskLevel,
      timeoutMs: this._timeoutMs,
      requiresApproval: this._requiresApproval,
      source: "function",
      ...(this._returnType ? { returnType: this._returnType } : {}),
      ...(this._category ? { category: this._category } : {}),
    };
    return { definition, ...(this._handler ? { handler: this._handler } : {}) };
  }
}
