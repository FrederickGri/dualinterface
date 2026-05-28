# dualinterface
# AI Paper Reader

A local browser-based research paper reader with two AI chat panels, PDF reading, text-mode fallback, and a saved word-card dictionary.

The app runs locally on your computer. PDFs, chat history, settings, and word cards are stored as local files in the `data/` and `uploads/` folders.

## Features

- Open and read PDFs in the browser.
- Chat with two AI panels:
  - Main AI for paper discussion and analysis.
  - Explainer AI for short explanations and tutoring.
- Save selected terms into word cards.
- Switch between native PDF view and extracted Text Mode.
- Use SiliconFlow by default, or configure DeepSeek, Qwen/DashScope, Volcengine Ark, OpenAI, or another OpenAI-compatible API.
- Double-click launchers for macOS and Windows.

## Roadmap

Planned future features:

- Toggleable MCP support for connecting external tools and local research workflows.
- Toggleable web search support for looking up papers, concepts, and related sources while reading.

## Requirements

- Python 3.11 or newer.
- A modern browser.
- An API key from your chosen AI provider.

Chrome or Edge is recommended for the native PDF viewer. Other browsers can still use the app, but PDF selection behavior may be less reliable. Text Mode and copy-then-explain work more consistently across browsers.

## Quick Start on macOS

1. Download or clone this repository.
2. Open the project folder.
3. Double-click:

```text
start.command
```

On first run, the launcher will:

- create a local `.venv` virtual environment
- install Python dependencies from `requirements.txt`
- start the local server
- open the app in your default browser

If macOS blocks the file, right-click `start.command`, choose `Open`, then confirm. If it still will not run, open Terminal in the project folder and run:

```bash
chmod +x start.command
./start.command
```

## Quick Start on Windows

1. Install Python 3.11 or newer from [python.org](https://www.python.org/downloads/).
2. During installation, enable `Add Python to PATH`.
3. Download or clone this repository.
4. Open the project folder.
5. Double-click:

```text
start.bat
```

On first run, the launcher will:

- create a local `.venv` virtual environment
- install Python dependencies from `requirements.txt`
- start the local server
- open the app in your default browser

If Windows asks for permission, allow the script to run.

## Manual Run

If the launchers do not work, run the app manually.

macOS/Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Windows:

```bat
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

Then open:

```text
http://127.0.0.1:8000/static/index.html
```

## AI Provider Setup

Open Settings inside the app and choose your provider.

Default provider:

```text
SiliconFlow
```

Default SiliconFlow model:

```text
deepseek-ai/DeepSeek-V4-Pro
```

You can also choose:

- DeepSeek
- Qwen / DashScope
- Volcengine Ark
- OpenAI
- Custom OpenAI-compatible API

For Volcengine Ark, the model field is often your endpoint ID. Use the `Custom model...` option if the model is not listed.

## Built-In API Key Option

There is an optional line in `app.py`:

```python
builtinapikey = ""
```

You may put a SiliconFlow key there for your own local copy. Do not commit a real API key to GitHub. For a public repository, keep this value empty and enter keys in the app Settings UI instead.

## Dictionary / Word Cards

Native PDF selection depends on what the browser exposes from its built-in PDF viewer. If direct selection does not trigger the app:

1. Select text in the PDF.
2. Press `Cmd+C` on macOS or `Ctrl+C` on Windows.
3. Click `Explain`.

Text Mode has the most reliable word selection because it is rendered directly by the app.

## Local Data

The app creates these folders automatically:

```text
data/
uploads/
```

They may contain:

- API settings
- uploaded PDFs
- extracted PDF text
- chat history
- word cards

These folders are private local data and should not be committed to GitHub.

## GitHub Publishing Checklist

Before publishing:

1. Keep `builtinapikey = ""` in `app.py`.
2. Do not commit `.venv/`.
3. Do not commit `data/`.
4. Do not commit `uploads/`.
5. Do not commit `__pycache__/`.
6. Check that `.gitignore` is present.

## Project Structure

```text
ai-paper-reader/
|-- app.py
|-- requirements.txt
|-- start.command
|-- start.bat
|-- static/
|   |-- index.html
|   |-- script.js
|   `-- style.css
|-- data/
`-- uploads/
```

## Notes

- The server runs on `127.0.0.1:8000`.
- The app is local-only by default.
- Closing the terminal window stops the app.
- If dependencies change, delete `.venv/` and run the launcher again.
