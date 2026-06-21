# Instructions to Start CurbIQ

## Windows

Double-click **`run.bat`** in File Explorer, or run it from Command Prompt:

```cmd
run.bat
```

The script will automatically:
1. Set up the Python virtual environment (`.venv`)
2. Install all dependencies if needed (with progress bars)
3. Download the dataset if missing
4. Build analytics artifacts if missing (first run only)
5. Start the dashboard server
6. Open **http://localhost:8000** in your default browser

## Linux / macOS

Run the shell script from your terminal:

```bash
chmod +x run.sh
./run.sh
```

The script will perform the same steps as above and open the dashboard in your browser.

---

## Options

| Flag | Description |
|------|-------------|
| `--rebuild` | Force-rebuild all analytics artifacts from raw data |
| `--reinstall` | Reinstall all Python dependencies |
| `--no-open` | Don't automatically open the browser |
| `--port N` | Use a different port (default: 8000) |
| `--host H` | Bind to a different host (default: 127.0.0.1) |

**Example:**
```cmd
run.bat --port 9000
```

---

## Requirements

- **Python 3.10+** must be installed and on your PATH
- **Internet connection** required only if the dataset or pip packages are missing
- Tested on Windows 10/11 and Ubuntu 22.04+
