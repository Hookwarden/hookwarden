"""hookwarden — Python shim that downloads and execs the standalone binary."""
from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("hookwarden")
except PackageNotFoundError:
    __version__ = "0.0.0"

__all__ = ["__version__"]
