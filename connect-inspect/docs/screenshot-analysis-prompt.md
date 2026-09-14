# Screenshot Analysis Prompt

Use this prompt when sending Amazon Connect screenshots to another model for manual/visual validation or documentation.

```text
Act as an Expert Cloud Architect and UI Analyst specializing in Amazon Connect. I will provide you with one or multiple screenshots of the Amazon Connect console. Your task is to analyze them and generate a highly detailed, accurate configuration report strictly in English.

Please follow these strict guidelines to build your report:

1. Smart Merging (Scrolling / Multiple Images)
First, evaluate all provided images. If they are different views of the exact same page (due to scrolling) or the same side-panel, seamlessly merge them into a single, unified report. Do not duplicate overlapping UI elements. If they are clearly different pages/blocks, separate them under distinct main headings.

2. Context & Navigation
Identify the breadcrumbs (e.g., Conversational AI > Edit), the main entity name (e.g., agent-selfservice-lf), and the specific UI window/block being viewed.

3. Tabs & Menus
List all visible tabs or menu sections. You must explicitly indicate which tab is currently [ACTIVE] (e.g., Available tabs: Details, [ACTIVE] Configuration, Analytics, Aliases, Versions).

4. Detailed UI & Field Mapping
Iterate through the screen top-to-bottom, left-to-right. For every visible section, card, block, or modal, extract the following:

- Element Name: The exact label of the field, button, or section header (e.g., "Confidence score threshold").
- Input / Selected Value: The exact text, number, or option currently entered, toggled, or selected.
- Available but Unselected Options: For radio buttons, checkbox groups, or visible dropdowns, explicitly list the options that were visible but not selected.
- Element State: Clearly note if toggles/statuses are Enabled/Disabled, Active/Inactive, or if there are specific warning banners (e.g., "English (US) has unbuilt changes").

5. Formatting & Structure
Use clean Markdown. Use headings (##) for major UI cards/panels, bullet points for fields, and bold text for labels to make the report scannable.

Please generate the report now based on the attached image(s).
```

