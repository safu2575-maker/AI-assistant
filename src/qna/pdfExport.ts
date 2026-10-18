import { jsPDF } from "jspdf";

export interface PdfReport { title: string; orientation?: "landscape" | "portrait"; notes?: string; columns?: string[]; rows?: string[][]; totalRowIndices?: number[]; chart?: Blob; }
export interface PdfPreview { pages: string[]; base64: string; }

/** Canvas pages preserve the report's Unicode labels without remote font requests. */
export async function createPdfReport(report: PdfReport): Promise<PdfPreview> {
    const orientation = report.orientation || "landscape";
    const width = orientation === "portrait" ? 792 : 1120, height = orientation === "portrait" ? 1120 : 792, margin = 36;
    const pdf = new jsPDF({orientation,unit:"pt",format:"a4",compress:true});
    const pages: string[] = [];
    const canvas = document.createElement("canvas"); canvas.width=width*2; canvas.height=height*2;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("PDF rendering is unavailable.");
    ctx.scale(2,2);
    const wrap = (text: string, max: number): string[] => {
        const result: string[]=[]; let line="";
        for(const char of String(text)) { if(char==='\n' || (line && ctx.measureText(line+char).width>max)){result.push(line);line=char==='\n'?'':char;}else line+=char; }
        result.push(line); return result;
    };
    const begin = (section: string): number => {
        ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);
        ctx.fillStyle="#245cf5";ctx.font="bold 20px Arial";ctx.fillText("askBICS",margin,38);
        ctx.fillStyle="#17233b";ctx.font="bold 16px Arial";
        const title=wrap(report.title,width-margin*2); if(title.length>8)throw new Error("Question is too long to export. Shorten the question and retry.");
        title.forEach((line,i)=>ctx.fillText(line,margin,65+i*20));
        ctx.font="12px Arial";ctx.fillStyle="#58677f";
        let y=75+title.length*20;
        for(const line of wrap([section,report.notes].filter(Boolean).join(" · "),width-margin*2)){ctx.fillText(line,margin,y);y+=16;}
        if(y>300)throw new Error("Too many filter details to fit on a PDF page. Narrow the export.");
        return y+12;
    };
    const finish = async () => {
        if(pages.length>=100)throw new Error("This report exceeds 100 PDF pages. Narrow the filters and export again.");
        ctx.fillStyle="#64748b";ctx.font="11px Arial";ctx.fillText(`Page ${pages.length+1} · ${new Date().toLocaleString()}`,margin,height-20);
        const page=canvas.toDataURL("image/jpeg",.92);pages.push(page);
        if(pages.length>1)pdf.addPage();
        pdf.addImage(page,"JPEG",0,0,pdf.internal.pageSize.getWidth(),pdf.internal.pageSize.getHeight());
        await new Promise<void>(resolve=>setTimeout(resolve,0));
    };
    if(report.chart){
        const url=URL.createObjectURL(report.chart);
        try { const img=new Image(); await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error("Chart could not be rendered."));img.src=url;});
            const y=begin("Chart — current view"); const scale=Math.min((width-margin*2)/img.width,(height-y-40)/img.height);
            ctx.drawImage(img,margin,y,img.width*scale,img.height*scale);await finish();
        } finally { URL.revokeObjectURL(url); }
    }
    if(report.columns?.length){
        const columns=report.columns, rows=report.rows || [];
        const bands:number[][]=[];
        if(columns.length<=6)bands.push(columns.map((_,i)=>i));
        else for(let i=1;i<columns.length;i+=5)bands.push([0,...columns.slice(i,i+5).map((_,j)=>i+j)]);
        for(const [bandIndex,band] of bands.entries()){
            const cellWidth=(width-margin*2)/band.length;
            const start=()=>{
                let y=begin(`${rows.length} rows · Columns ${bandIndex+1}/${bands.length}`);
                ctx.font="bold 12px Arial";const headings=band.map(i=>wrap(columns[i],cellWidth-16));
                const h=Math.max(...headings.map(lines=>lines.length))*16+16;
                if(h>180)throw new Error("A column heading is too long to export.");
                ctx.fillStyle="#e9f0ff";ctx.fillRect(margin,y,width-margin*2,h);ctx.fillStyle="#203c6b";
                headings.forEach((lines,col)=>lines.forEach((line,l)=>ctx.fillText(line,margin+col*cellWidth+8,y+20+l*16)));
                y+=h;return y;
            };
            let y=start();
            for(const [index,row] of rows.entries()){
                const isTotal=report.totalRowIndices?.includes(index);
                ctx.font=isTotal ? "bold 12px Arial" : "12px Arial";const cells=band.map(i=>wrap(String(row[i] ?? ""),cellWidth-16));
                const h=Math.max(...cells.map(lines=>lines.length))*16+12;
                if(h>height-340)throw new Error("A cell is too long for one PDF page. Shorten it before exporting.");
                if(y+h>height-40){await finish();y=start();ctx.font=isTotal ? "bold 12px Arial" : "12px Arial";}
                if(y+h>height-40)throw new Error("A row cannot fit beneath the report headings. Shorten the question or cell text.");
                ctx.fillStyle=isTotal ? "#e9f0ff" : index%2 ? "#f4f7fb":"#ffffff";ctx.fillRect(margin,y,width-margin*2,h);ctx.fillStyle="#17233b";
                cells.forEach((lines,col)=>lines.forEach((line,l)=>ctx.fillText(line,margin+col*cellWidth+8,y+18+l*16)));y+=h;
            }
            if(!rows.length){ctx.fillStyle="#64748b";ctx.font="13px Arial";ctx.fillText("No matching rows.",margin+8,y+22);}
            await finish();
        }
    }
    if(!pages.length)throw new Error("There is no result to export.");
    return {pages,base64:pdf.output("datauristring").split(",")[1]};
}
