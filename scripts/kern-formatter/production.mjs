import { KERN_FORMATTER_REQUEST_FORMAT } from '../../packages/cli/dist/kern-formatter-contract.js';
import { runKernFormatter as runCompiledKernFormatter } from '../../packages/cli/dist/kern-formatter-runtime.js';

export function formatKernSource(source, options = {}) {
  return runCompiledKernFormatter({ format: KERN_FORMATTER_REQUEST_FORMAT, source }, options);
}
