/** Explanations shared by native controls and searchable settings pickers. */
const help: Record<string, string> = {
    "Enable Explain & investigate": "Questions containing explain or variance analyse the business dimensions available to askBICS. Ordinary questions keep their existing behaviour.",
    "Show percentage of revenue for each period": "Adds a percentage for each period using Percentage of Revenue settings. The denominator keeps relevant business filters and replaces financial hierarchy filters.",
    "Hide unchanged members": "Hides members whose amounts are equal in both periods. Overall totals still include them. Changes from or to zero remain visible.",
    "Analysis default measure": "Used only when the question does not name a measure. A measure named in the question takes priority.",
    "Default comparison for variance questions": "Used only when a comparison is requested. Single-period explanations remain single-period. An explicitly named comparison overrides this default.",
    "When period is omitted": "Applies only when the question has no period. If you ask for June 2025, the answer uses June 2025.",
    "Analysis result count": "Limits the members shown in each dimension section. Variance ranks by absolute change, while keeping the displayed + or − sign.",
    "Include Others": "Combines members outside the Top list into one row. Selecting Others explores those remaining members.",
    "Show variance percentage": "Shows (current amount − comparison amount) ÷ absolute comparison amount. A zero comparison displays —.",
    "Show analysis grand totals": "Shows the total for the full filtered result, including members outside the Top list.",
    "Favourable movement": "Controls whether increases or decreases receive favourable colouring. Neutral leaves values uncoloured.",
    "Breakdown keywords": "Words that request a breakdown across dimensions, such as explain. Separate alternatives with commas.",
    "Variance keywords": "Words that request a period comparison, such as variance or difference. Separate alternatives with commas.",
    "Test an analysis question": "Try a question here to check its interpretation before publishing. The preview does not query data.",
    "Validate draft": "Checks the selected fields, measure and keywords. It does not activate the draft.",
    "Publish template": "Prepares this draft for use. Click Save settings to activate the published version.",
    "Disable templates": "Stops template matching after you save settings. Your draft is retained.",
    "Preview interpretation": "Shows which measure, periods and hierarchy the question would use, without querying data.",
    "Revenue field": "Choose the field that identifies revenue, such as LineItem. Its configured revenue member becomes the percentage denominator.",
    "Revenue value": "Choose the revenue member, such as Total Net Revenue. Other amounts are divided by its value for the same period.",
    "Save settings": "Applies your preferences, including Explain & investigate, immediately.",
    "Cancel": "Closes this dialog without saving its changes.",
    "Use a small startup query": "Loads only the selected fields and measure initially. Other fields are requested when needed.",
    "Use cardinality to choose table or matrix": "Chooses a layout based on how many distinct values each field contains. An explicit layout in the question takes priority.",
    "Order matrix hierarchy from low to high cardinality": "Places fields with fewer distinct values before more detailed fields when arranging a matrix automatically.",
    "Matrix threshold (%)": "Controls when distinct-value counts favour a matrix instead of a flat table.",
    "Maximum column values": "Limits how many distinct values can become matrix columns. Zero removes this configured limit."
};
export function settingsHelp(label: string): string | undefined {
    const name = label.trim().split(": ")[0];
    if (help[name]) return help[name];
    if (/^Transaction field \d+$/.test(name)) return "Shown only in the transaction popup after Show transactions. Include a unique transaction ID to keep individual entries separate. Up to four fields are supported.";
    if (/^Include /.test(name)) return "Includes this business dimension in investigation. Untick to hide its section; ordinary questions and filters remain available.";
    if (/^Hierarchy level \d+$/.test(name)) return "Choose fields from parent to child, for example Group → Category → Tenant. Selecting a parent shows its children.";
    if (/^Revenue hierarchy child/.test(name)) return "Removes this accounting child restriction from the revenue denominator while preserving unrelated filters.";
    if (/^MonthIndex/i.test(name)) return "A numeric month sequence used to select continuous YTD and trailing-12-month windows.";
    if (/^Year column$/.test(name)) return "Maps year references in questions to your model's year field.";
    if (/^Month column$/.test(name)) return "Maps month names in questions to your model's month field.";
    if (/^Ambiguous numeric periods/.test(name)) return "Chooses how to read dates such as 06/07 when the month and year order is unclear.";
    if (/^Two-digit year window starts at/.test(name)) return "Sets the start of the 100-year window used for short years. A start of 2000 interprets 26 as 2026.";
    if (/^Startup field/.test(name)) return "A grouping field to request when the visual first loads. It does not restrict later questions.";
    if (/^Startup measure/.test(name)) return "The measure requested when the visual first loads. Users can still ask for other measures.";
    return undefined;
}
export function settingsOptionHelp(value: string): string | undefined {
    return ({
        "Same period last year": "Compares the requested period with the equivalent period one year earlier.",
        "Previous month (monthly questions)": "Compares a monthly question with the preceding month. For YTD or TTM, name the comparison explicitly.",
        "Ask the user for a period": "Requests a period when none is provided instead of choosing one automatically.",
        "Last completed calendar month": "Uses the month before today only when no period is provided. This is not the latest month found in the model.",
        "All members": "Shows every returned member rather than a Top list."
    } as Record<string, string>)[value] || (/^Top \d+$/.test(value) ? "Shows this many leading members at each level. Enable Others to include the remainder in one row." : undefined);
}
