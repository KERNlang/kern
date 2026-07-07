/**
 * Canonical set of Python builtin exception class names.
 *
 * Single source of truth shared by BOTH Python error-handle extractors — the
 * tree-sitter/AST path (`@kernlang/review-python`) and the regex fallback
 * (`./python-fallback/extractors/error.ts`) — so the two paths can never drift
 * (agon review flagged verbatim duplication as a parity-drift risk).
 *
 * Used by the `ignored-error` classifier: a silent swallow (`except … : pass`)
 * of a builtin exception stays flaggable because a builtin is broad enough to
 * hide an UNRELATED failure, whereas a non-builtin (library/domain) exception is
 * treated as an intentional expected-condition pattern. `Exception` /
 * `BaseException` (and the 3.11 `ExceptionGroup` / `BaseExceptionGroup`) are
 * included so a broad catch is never mistaken for "narrow", and every builtin
 * `Warning` subclass is listed so `except DeprecationWarning: pass` is not
 * mis-read as a domain exception.
 *
 * Kept as bare class names (no module qualifier); callers match against the
 * final dotted segment of the caught type.
 */
export const PYTHON_BUILTIN_EXCEPTIONS: ReadonlySet<string> = new Set<string>([
  // Base + system-exiting
  'BaseException',
  'Exception',
  'BaseExceptionGroup',
  'ExceptionGroup',
  'GeneratorExit',
  'KeyboardInterrupt',
  'SystemExit',
  // Arithmetic
  'ArithmeticError',
  'FloatingPointError',
  'OverflowError',
  'ZeroDivisionError',
  // Common builtins
  'AssertionError',
  'AttributeError',
  'BufferError',
  'EOFError',
  'ImportError',
  'ModuleNotFoundError',
  'LookupError',
  'IndexError',
  'KeyError',
  'MemoryError',
  'NameError',
  'UnboundLocalError',
  'ReferenceError',
  'RuntimeError',
  'NotImplementedError',
  'RecursionError',
  'StopIteration',
  'StopAsyncIteration',
  'SyntaxError',
  'IndentationError',
  'TabError',
  'SystemError',
  'TypeError',
  'ValueError',
  'UnicodeError',
  'UnicodeDecodeError',
  'UnicodeEncodeError',
  'UnicodeTranslateError',
  // OSError and its aliases / subclasses
  'OSError',
  'IOError',
  'EnvironmentError',
  'BlockingIOError',
  'ChildProcessError',
  'ConnectionError',
  'BrokenPipeError',
  'ConnectionAbortedError',
  'ConnectionRefusedError',
  'ConnectionResetError',
  'FileExistsError',
  'FileNotFoundError',
  'InterruptedError',
  'IsADirectoryError',
  'NotADirectoryError',
  'PermissionError',
  'ProcessLookupError',
  'TimeoutError',
  // Warning and every builtin subclass
  'Warning',
  'DeprecationWarning',
  'PendingDeprecationWarning',
  'UserWarning',
  'SyntaxWarning',
  'RuntimeWarning',
  'FutureWarning',
  'ImportWarning',
  'UnicodeWarning',
  'BytesWarning',
  'ResourceWarning',
  'EncodingWarning',
]);
