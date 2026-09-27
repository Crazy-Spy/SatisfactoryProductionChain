# Satisfactory Production Chain

A visual factory planner for [Satisfactory](https://www.satisfactorygame.com/) (1.0+).

Most factory calculators out there are great for late-game min-maxing and massive spreadsheets, but when I'm actually playing, I usually just want quick answers to two simple questions:

1. **"What do I need to build to automate this part from scratch?"**
2. **"I have an overflow of X parts/min on a belt, what can I turn them into right now?"**

I built this tool to answer both without any logins, tracking, or bloated setups. It's a single static web app that runs 100% in your browser.

---

## What It Does

### 1. Full Production Chain (Target Item → Raw Resources)
Pick any item (e.g. Heavy Modular Frame, Computer, Battery) and set your target rate (e.g. `2/min`):
* **Visual Factory Graph:** See how items flow between machines. You can drag nodes around, pan, and zoom to map out your factory layout.
* **Hierarchy Tree View:** If you prefer a structured breakdown, toggle to the tree view (supports both top-down and bottom-up flows).
* **Machine Counts:** Shows the exact number of Smelters, Constructors, Assemblers, Refineries, etc. needed.
* **Alternate Recipes:** Click any step to swap in an alternate recipe. The graph and machine counts recalculate instantly.
* **By-Product Handling & Closed-Loop Recycling:** Automatically tracks secondary outputs (Water, Silica, Heavy Oil Residue, Polymer Resin). If a by-product can be looped back into the line (like Water from Aluminum Scrap into Alumina Solution), you can toggle **Closed-Loop: ON** to offset raw extraction and see the feedback loop on the diagram. It also reminds you that fluids can't go straight into the AWESOME Sink without a Packager.

### 2. Next Step Explorer ("What can I make with this?")
For when you're expanding an existing factory or have extra output from an existing manifold:
* Enter an item and your current supply (e.g. `225 Wire/min`).
* See all immediate crafting recipes that consume that item, what else they require, and how much they produce.
* **Overclocking & Compaction:** Includes a clock speed slider (1% to 250%) and quick presets (e.g. turning 4.5 constructors into 3 overclocked constructors) along with exact Power Shard counts.

### 3. Load Your Save File (`.sav`)
Drop your Satisfactory save file directly onto the page:
* Scans which alternate recipes you've actually unlocked via MAM Hard Drives.
* Option to hide locked recipes so you don't plan around alternates you don't have yet.
* Shows playtime and unlocked alternates count.
* **Privacy:** Your save file is parsed entirely inside your browser using the native Web Streams API. Nothing is uploaded anywhere.

---

## Running It Locally

This is just a static website (HTML, CSS, vanilla JS) with local JSON files for game data. 

Because modern browsers block `fetch()` requests on raw `file:///` URLs due to CORS, you just need a quick local HTTP server:

**Using VS Code:**
Right-click `index.html` and choose **Open with Live Server**.

**Using Python:**
```bash
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

**Using Node / npx:**
```bash
npx serve .
```

---

## Credits & Disclaimer

* Built by **CrazySpy** (also credited in the official Satisfactory game credits!).
* Game data and assets belong to **Coffee Stain Studios**.
* This is an unofficial fan project and is not affiliated with or endorsed by Coffee Stain Studios.
* Open source under the [MIT License](LICENSE).
