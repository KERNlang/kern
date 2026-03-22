# ═══════════════════════════════════════════════════════════════════════
# KERN MCP Security Benchmark — Python SAFE Server
# ═══════════════════════════════════════════════════════════════════════
#
# Properly secured patterns. Should trigger 0 findings (false positive check).
# ═══════════════════════════════════════════════════════════════════════

import os
import subprocess
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("safe-server")

ALLOWED_DIR = "/data/workspace"


# Safe: subprocess.run with list args, no shell=True
@mcp.tool()
def list_files(directory: str) -> str:
    """List files in workspace directory"""
    safe_path = os.path.realpath(os.path.join(ALLOWED_DIR, directory))
    if not safe_path.startswith(ALLOWED_DIR):
        return "Access denied"
    result = subprocess.run(["ls", "-la", safe_path], capture_output=True, text=True)
    return result.stdout


# Safe: path containment check with realpath + startswith
@mcp.tool()
def read_file(path: str) -> str:
    """Read a file from the workspace"""
    safe_path = os.path.realpath(os.path.join(ALLOWED_DIR, path))
    if not safe_path.startswith(ALLOWED_DIR):
        return "Path traversal blocked"
    with open(safe_path) as f:
        return sanitize_response(f.read())


# Safe: clean description
@mcp.tool()
def summarize(text: str) -> str:
    """Summarize the given text input"""
    return f"Summary: {text[:100]}"


# Safe: API key from environment
@mcp.tool()
def search(query: str) -> str:
    """Search the web"""
    import requests
    api_key = os.environ.get("SEARCH_API_KEY")
    resp = requests.get(f"https://api.search.com?key={api_key}&q={query}")
    return sanitize_response(resp.text)


# Safe: typed params with Pydantic validation
@mcp.tool()
def calculate(operation: str, a: float, b: float) -> str:
    """Perform a math calculation"""
    ops = {"add": lambda: a + b, "subtract": lambda: a - b}
    if operation not in ops:
        return "Invalid operation"
    return str(ops[operation]())


def sanitize_response(s: str) -> str:
    return s  # placeholder
