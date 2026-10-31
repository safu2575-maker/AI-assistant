/** Explanations shared by native controls and searchable settings pickers. */
const help: Record<string, string> = {
    "Enable document links": "Makes document numbers clickable in transaction tables. Opens lines with the same document number, company and fiscal year, without question, period or selected-category filters. Always filters remain applied.",
    "Document number field": "Choose the accounting document number column. Include this column in transaction fields. Blank document numbers remain plain text.",
    "Document fiscal year field": "Choose the document fiscal year to distinguish numbers reused across years. Include it in transaction fields.",
    "Document amount measure": "Measure displayed for document lines and their model-calculated total. Question, period and transaction-rule filters do not restrict this lookup. Always filters remain applied.",
    "Document detail columns": "Choose up to ten fields for the document popup when Use transaction columns is off.",
    "Enable clearing links": "Makes nonblank clearing document numbers clickable in transaction details. Opens related items with the same clearing reference, company and clearing fiscal year; question, period and selected-category filters are omitted. Always filters remain applied.",
    "Clearing document field": "Choose the column containing the clearing reference shared by related invoice and payment items. Include it in transaction columns. Blank references are not clickable.",
    "Company code field": "Uses the clicked row's company to limit the lookup, so identical document references in different companies are not mixed. Include this field in transaction columns.",
    "Clearing fiscal year field": "Uses the clicked row's clearing fiscal year to distinguish reused clearing numbers. Choose the clearing year, not automatically the invoice posting year, and include it in transaction columns.",
    "Clearing amount measure": "The measure shown for related clearing items and their model-calculated total. Signed values are preserved; a clearing group is not assumed to total zero.",
    "Use transaction columns": "Reuses your configured transaction columns in the details popup. Turn off to choose a separate set of detail columns.",
    "Clearing detail columns": "Choose the columns displayed in the clearing popup when transaction columns are not reused. This changes the displayed detail, not the company, clearing year or existing filter scope.",
    "Enable transaction rule": "Applies the saved rule when transaction details open. Ordinary answers do not use this rule. Turn off to show transaction details without this additional rule.",
    "Transaction ID field": "Required for Conditions and confirmed offsetting pairs. Reference lookup does not need a Row ID. Choose a nonblank ID unique to each transaction line, and include it in Transaction fields. Document numbers can repeat across lines and are not necessarily unique.",
    "Rule name": "A short name shown above the transaction table so users know which rule is active.",
    "Rule type": "Conditions exclude rows using comparisons. Document matching checks reversal references against document numbers.",
    "Matching method": "Reference lookup matches Rev With against Doc No, like VLOOKUP, without checking amounts. Confirmed offsetting pairs additionally checks both documents and their signed amounts.",
    "Document number": "The column containing document numbers to search. Multiple transaction lines may share the same document number.",
    "Rev With / reversal reference": "The column containing the referenced document number. Reference lookup excludes a row when this value exists in Document number within the current filtered scope.",
    "Signed amount measure (additive)": "A measure that sums signed transaction amounts. Used only for confirmed offsetting pairs; do not use a ratio or ABS measure.",
    "Matching scope fields": "Optional company, fiscal year or currency columns. Matches must have the same values in these fields, preventing unrelated documents with the same number from matching.",
    "Condition editor": "Use Builder for simple comparisons, or Formula for nested AND/OR conditions. Both define which rows are excluded.",
    "Match": "All conditions requires every condition to match (AND). Any condition requires at least one (OR).",
    "Operator": "Choose how the value is compared: equals, differs, greater/less than, membership (IN), or blank (ISBLANK).",
    "Field or measure": "Choose the value evaluated by the condition. Measures are evaluated at the configured transaction ID level.",
    "KPI name": "The name users can enter in questions to request this calculated KPI.",
    "KPI formula": "Calculates a KPI from measures. Each row and total recalculates the formula using its own filtered inputs.",
    "KPI decimal places": "Controls displayed precision; does not change the underlying calculation.",
    "Allowed values": "Select one or more values. Values in one field use OR; different filter fields use AND. Existing question and Always filters still apply.",
    "Group name": "A name users can enter to request the fields or measures in this group together.",
    "Group type": "Field groups add grouping columns. Measure groups add separate measure columns.",
    "Synonyms (comma-separated)": "Alternative names users can type for this item. Separate names with commas.",
    "Waterfall category": "The field or field group used to identify waterfall steps.",
    "Waterfall measure": "The measure supplying the values for waterfall steps.",
    "Positive movements": "Default colour for increasing waterfall movements; does not change their sign or value.",
    "Negative movements": "Default colour for decreasing waterfall movements; does not change their sign or value.",
    "Totals": "Default colour for waterfall total bars.",
    "Category labels": "Controls how waterfall step names wrap or rotate to fit the chart.",
    "Value labels": "Controls the display of amounts above waterfall bars.",
    "Category order": "Financial order preserves the configured step sequence. Positive first orders movements by sign while respecting total boundaries.",
    "Parameter table": "Advanced override for the bound Power BI field-parameter table. Prefer automatic detection.",
    "Parameter label column": "The column containing the parameter display names, not the underlying model fields.",

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
    "Maximum column values": "Category fields with more than 12 distinct column values move to rows. Month and year fields stay in columns. All values are retained; this fixed readability rule also applies to requested column layouts."
};
export function settingsHelp(label: string): string | undefined {
    const name = label.trim().split(": ")[0];
    if (help[name]) return help[name];
    if (/^Transaction field \d+$/.test(name)) return "Shown only in the transaction popup after Show transactions. Include a unique transaction ID to keep individual entries separate. Up to 10 fields are supported.";
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

/** Help markers use the shared tooltip host and never activate their enclosing label. */
export function installSettingsHelp(root:HTMLElement):()=>void {
    const decorate=()=>{
        for(const label of Array.from(root.querySelectorAll<HTMLElement>('label,[data-settings-help]'))){
            if(label.querySelector('.askbics-settings-help-icon')||label.closest('.askbics-settings-select__popup'))continue;
            const name=Array.from(label.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent||'').join(' ').trim();
            if(!name)continue;
            const control=label.querySelector<HTMLElement>('input,select,textarea');
            const description=label.dataset.settingsHelp||settingsHelp(name)||control?.dataset.tooltip;
            if(!description)continue;
            const marker=document.createElement('span');marker.className='askbics-settings-help-icon';marker.textContent='?';marker.tabIndex=0;marker.setAttribute('role','note');marker.setAttribute('aria-label',name+': '+description);marker.dataset.tooltip=description;
            marker.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
            const text=Array.from(label.childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim());
            if(text){const caption=document.createElement('span');caption.className='askbics-settings-help-caption';text.replaceWith(caption);caption.append(text,marker);}else label.append(marker);
        }
    };
    decorate();
    const observer=new MutationObserver(decorate);observer.observe(root,{childList:true,subtree:true});
    return ()=>observer.disconnect();
}


