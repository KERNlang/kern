/**
 * @kernlang/fastapi — FastAPI Python backend transpiler
 */

export { generatePythonCoreNode } from './codegen-python.js';
export { transpileFastAPI } from './transpiler-fastapi.js';
export { mapTsTypeToPython, toScreamingSnake, toSnakeCase } from './type-map.js';
