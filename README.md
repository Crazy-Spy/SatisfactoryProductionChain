# Satisfactory Production Chain

> **FICSIT Inc. Approved Factory Automation Planner • Satisfactory 1.0 – 1.2 Ready**  
> *"What do I need to build to AUTOMATE any item?"*

[![Satisfactory 1.2 Ready](https://img.shields.io/badge/Satisfactory-1.0%20--%201.2%20Ready-f97316?style=for-the-badge&logo=unrealengine)](https://www.satisfactorygame.com/)
[![100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20Client--Side-22c55e?style=for-the-badge&logo=shield)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-0284c7?style=for-the-badge)](LICENSE)

An intuitive, fast, and visual factory planning tool for **Satisfactory**. Instead of overwhelming you with complex spreadsheets and linear programming matrices before you even know where to start, this tool gives you an immediate industrial blueprint: select any item and instantly see what **raw resources** to harvest, what **intermediate components** are synthesized, which **machines** are required, and the complete **factory flow diagram**.

⭐ **Created by CrazySpy** • *Proudly featured in the official Satisfactory game credits!* ⭐

---

## 🌟 Why This Tool?

Many existing calculators focus on late-game clock tuning, power math, and complicated percentage ratios. When you are exploring or starting a new production line, you often just want the answers to three fundamental questions:

1. **Where do I start?** What raw ores and fluids (Iron, Copper, Coal, Crude Oil, etc.) do I need to bring to my factory?
2. **What gets built along the way?** What intermediate parts must be crafted?
3. **What machines and how many do I need?** How many Manufacturers, Assemblers, Refineries, or Constructors must I place down?

**Satisfactory Production Chain** answers all of this in seconds with zero friction, zero account setup, and 100% privacy.

---

## 🚀 Key Features

### 🕸️ 1. Interactive Factory Graph (DAG Flowchart)
The primary view provides a visual, directed acyclic graph (DAG) of your factory line:
* **Multi-Port Curved Conveyors:** Belts connect smoothly between machines using multi-port cubic Bézier geometry without crossing curves.
* **Interactive Drag & Drop:** Click and drag any machine or product node freely to organize your factory floor plan.
* **Target Rate Scaling:** Adjust your desired production rate (e.g., `1`, `2.5`, or `10` parts/min) and watch machine requirements and flow rates adapt in real-time.
* **Pan & Zoom Controls:** Effortlessly navigate large factory lines with Zoom In, Zoom Out, Auto-Fit, and Reset to original layout.

### 📋 2. Automation Blueprint Summary (Plain-Text Interpretation)
Located directly beneath the target banner, this card translates the entire factory graph into clean, human-readable English:
* **Raw Resources:** Shows every natural raw resource needed with official icons.
* **Intermediate Components:** Lists every synthesized part generated along the chain.
* **Exact Machine Multipliers:** Calculates the exact number of machines needed for your target rate (e.g., `0.4× Manufacturer`, `1.6× Refinery`, `0.53× Assembler`).
* **Active Recipe Disclosure:** Clearly states whether the chain is calculated `📋 utilizing standard recipes` or `⚡ utilizing custom alternate recipes`.

### ⚡ 3. Full Alternate Recipes System
Customize any step of your production chain with alternate recipes:
* **Dynamic Factory Morphing:** Switching a recipe (e.g., standard *Concrete* to *Alternate: Wet Concrete*) instantly replaces Constructors with Refineries, adds Water as an extraction input, and recalculates conveyor flows.
* **Visual Identifiers:** Machine nodes using alternate recipes feature a distinctive pulsating amber glow ring (`[ALT]`).
* **1-Click Reset:** Easily revert any or all customizations back to standard recipes with the `↺ Restore Defaults` button.

### 💾 4. Save Game Integration (`.sav`)
Load your actual Satisfactory savegame to automatically align the planner with your in-game world progress:
* **100% Client-Side & Private:** Save files never leave your computer. The parser decompresses Unreal Engine chunks directly in your browser using the native `DecompressionStream` API.
* **M.A.M. Hard Drive Scanning:** Automatically reads your researched recipes and tags them as unlocked (`⭐ [ALT]`) or unresearched (`🔒 [LOCKED]`).
* **"Hide Locked Recipes" Filter:** Toggle this option to only see alternate recipes you have actually unlocked in your world.
* **World Metadata:** Displays your session name, playtime duration, and total unlocked alternates in the header.
* **Convenient Drag & Drop:** Drop your `.sav` file anywhere onto the page. An interactive guide `(i)` provides Windows shortcuts and exact save paths for both Steam and Epic Games.

### 🌳 5. Hierarchy Tree View
A secondary structured view designed for in-depth hierarchical analysis:
* **Top-Down Mode:** Traces dependencies from the final product down to raw natural resources.
* **Bottom-Up Mode:** Inverts the flow, following raw ores forward as they are processed into higher-tier parts.
* **Collapsible Branches:** Expand and collapse individual branches or use the global *Expand All / Collapse All* controls.

### 🔍 6. Fast Search & Quick Select
* Instantly search through **all 203 items** in Satisfactory with live highlighting and official transparent 3D icons.
* Quick-select chips for staple milestone items (*Computer*, *Crystal Oscillator*, *Heavy Modular Frame*, *Motor*, *Circuit Board*, *Rotor*, *Modular Frame*).
* Full keyboard navigation (<kbd>↓</kbd>, <kbd>↑</kbd>, <kbd>Enter</kbd>, <kbd>Esc</kbd>).

---

## 🛠️ How to Use

### Online
Open the deployed web application in any modern web browser (Chrome, Edge, Firefox, Safari). No installation, plugins, or extensions required.

### Running Locally
Because the app loads local game datasets (`data/*.json`), it should be served via HTTP rather than opened as a raw `file://` URI:

* **VS Code:** Install the *Live Server* extension, right-click `index.html`, and select **"Open with Live Server"**.
* **Python:** Run `python -m http.server 8080` in the repository folder and open `http://localhost:8080`.
* **Node.js:** Run `npx serve .` in the repository folder.

---

## 🔮 Future Implementations & Roadmap

We are continuously listening to community feedback to expand the tool while preserving its lightweight, zero-clutter philosophy:

* **Extraction Node Profiler / Recommender:**
  * Estimating the type and number of resource nodes needed (Impure, Normal, Pure) across Miner tiers (Mk.1, Mk.2, Mk.3) to satisfy raw ore demand.
  * Non-intrusive extraction hints in the blueprint summary (e.g., *"Requires 40 Copper Ore/min → can be supplied by 1 Normal Node with Miner Mk.1 at 66%"*).
* **Bottleneck / Resource-Capped Calculation:**
  * An optional secondary mode allowing pioneers to input available raw supply (e.g., *"I have 120 Crude Oil/min"*) and calculate the maximum target output achievable with that input limit.
* **Factory Power Consumption Estimate:**
  * Aggregate MW energy consumption estimation based on active machine counts and building types.

---

## 🛡️ Privacy & Security

* **Zero Tracking:** No analytics, trackers, cookies, or external telemetry scripts are included.
* **Offline-First:** All item, recipe, building, and resource datasets are stored statically within the project.
* **Local Save Parsing:** Your `.sav` files are processed strictly in local browser memory and are never uploaded to any remote server.

---

## 📜 Credits & Legal

* **Creator:** Created with pride by **CrazySpy** — featured in the official **Satisfactory** game credits!
* **Satisfactory:** Satisfactory is a game developed and published by **Coffee Stain Studios**. All game assets, building icons, item names, and trademarks belong to Coffee Stain Studios.
* **License:** This project is open source and available under the [MIT License](LICENSE).
