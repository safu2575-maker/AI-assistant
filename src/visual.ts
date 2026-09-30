import powerbi from "powerbi-visuals-api";
import { buildContext } from "./dataAdapter";
import { GlobalQnaEngine } from "./qna/engine";
import { GlobalQnaUi } from "./qna/ui";
import "../style/visual.less";

export class Visual implements powerbi.extensibility.visual.IVisual {
    private readonly host: powerbi.extensibility.visual.IVisualHost;
    private readonly selection: powerbi.extensibility.ISelectionManager;
    private readonly engine: GlobalQnaEngine;
    private readonly ui: GlobalQnaUi;
    private table?: powerbi.DataViewTable;
    private selectedIndices: number[] = [];
    private restoredState = "";

    constructor(options: powerbi.extensibility.visual.VisualConstructorOptions) {
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        options.element.classList.add("askbics-host");
        this.engine = new GlobalQnaEngine(buildContext(undefined));
        this.ui = new GlobalQnaUi(options.element, this.engine, this.selectRows, this.persistState, this.showContextMenu);
    }

    public update(options: powerbi.extensibility.visual.VisualUpdateOptions): void {
        this.table = options.dataViews?.[0]?.table;
        this.selectedIndices = this.selectedIndices.filter((index) => index >= 0 && index < (this.table?.rows.length || 0));
        this.engine.updateContext(buildContext(this.table));
        this.ui.updateEngine(this.engine);
        const stored = String(options.dataViews?.[0]?.metadata?.objects?.state?.conversation || "");
        if (stored && stored !== this.restoredState) {
            try { this.ui.restoreState(JSON.parse(stored)); this.restoredState = stored; } catch { this.restoredState = ""; }
        }
        if (options.dataViews?.[0]?.metadata?.segment) this.host.fetchMoreData();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return { cards: [] };
    }

    private persistState = (): void => {
        const value = JSON.stringify(this.ui.getState());
        this.restoredState = value;
        this.host.persistProperties({ merge: [{ objectName: "state", selector: null, properties: { conversation: value } }] });
    };

    private selectRows = (indices: number[], additive = false): void => {
        if (!this.table) return;
        const valid = Array.from(new Set(indices)).filter((index) => index >= 0 && index < this.table!.rows.length);
        const sameSelection = !additive && valid.length > 0 && valid.length === this.selectedIndices.length && valid.every((index) => this.selectedIndices.includes(index));
        const nextIndices = sameSelection ? [] : valid;
        const identities = nextIndices.map((index) => this.host.createSelectionIdBuilder().withTable(this.table!, index).createSelectionId());
        const action = identities.length ? this.selection.select(identities, additive) : this.selection.clear();
        action.then(() => {
            this.selectedIndices = additive ? Array.from(new Set(this.selectedIndices.concat(nextIndices))) : nextIndices;
            this.engine.updateContext(buildContext(this.table, this.selectedIndices));
            this.ui.updateEngine(this.engine);
        });
    };

    private showContextMenu = (indices: number[], position: { x: number; y: number }): void => {
        if (!this.table) return;
        const index = indices.find((item) => item >= 0 && item < this.table!.rows.length);
        if (index === undefined) return;
        this.persistState();
        const identity = this.host.createSelectionIdBuilder().withTable(this.table, index).createSelectionId();
        this.selection.showContextMenu(identity, position);
    };
}
