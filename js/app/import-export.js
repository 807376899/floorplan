(function attachFloorplanImportExport(global) {
  const {
    DATASETS,
    csv,
    pick,
    emptyDataset,
    escapeHtml,
    templateInstructions,
    templateRows,
  } = global.FloorplanDomain;

  function workbookAvailable() {
    return Boolean(global.XLSX?.utils?.book_new);
  }

  function readWorkbookDataset(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const data = emptyDataset();
    for (const definition of DATASETS) {
      const sheet = workbook.Sheets[definition.sheet] || workbook.Sheets[definition.label];
      data[definition.key] = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    }
    data.file_assets = workbook.Sheets.file_assets ? XLSX.utils.sheet_to_json(workbook.Sheets.file_assets, { defval: "" }) : [];
    data.imports = workbook.Sheets.imports ? XLSX.utils.sheet_to_json(workbook.Sheets.imports, { defval: "" }) : [];
    return data;
  }

  function downloadCurrentSheet(state, editorRows, updateStatus) {
    const definition = DATASETS.find((item) => item.key === state.editorKey);
    const rows = editorRows().map((row) => Object.fromEntries(definition.columns.map(([key]) => [key, row[key] ?? ""])));
    exportCsv(`${definition.sheet}.csv`, definition.columns, rows);
    updateStatus("当前表已开始下载。");
  }

  function downloadTemplateWorkbook(updateStatus) {
    try {
      if (!workbookAvailable()) {
        downloadJson("实验室布局维护模板.json", buildTemplatePackage());
        updateStatus("当前环境未加载 Excel 组件，已降级下载 JSON 模板。");
        return;
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateInstructions()), "说明");
      for (const definition of DATASETS) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(templateRows(definition.key)), definition.sheet);
      XLSX.writeFile(workbook, "实验室布局维护模板.xlsx");
      updateStatus("模板已开始下载。");
    } catch (error) {
      downloadJson("实验室布局维护模板.json", buildTemplatePackage());
      updateStatus(`Excel 模板生成失败，已降级下载 JSON 模板：${error.message}`);
    }
  }

  function exportWorkbook(state, updateStatus) {
    try {
      // SheetJS CDN 不可用时，保留 JSON 数据包能力，保证离线环境也能导入导出。
      if (!workbookAvailable()) {
        downloadJson("实验室布局维护数据包.json", state.data);
        updateStatus("当前环境未加载 Excel 组件，已降级下载 JSON 数据包。");
        return;
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateInstructions()), "说明");
      for (const definition of DATASETS) {
        const rows = state.data[definition.key].map((row) => exportRow(definition.key, row));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), definition.sheet);
      }
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.data.file_assets), "file_assets");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.data.imports), "imports");
      XLSX.writeFile(workbook, "实验室布局维护数据包.xlsx");
      updateStatus("数据包已开始下载。");
    } catch (error) {
      downloadJson("实验室布局维护数据包.json", state.data);
      updateStatus(`Excel 数据包导出失败，已降级下载 JSON 数据包：${error.message}`);
    }
  }

  function buildTemplatePackage() {
    return Object.fromEntries(DATASETS.map((definition) => [definition.key, templateRows(definition.key)]));
  }

  function exportRow(key, row) {
    const fields = DATASETS.find((item) => item.key === key).columns.map(([field]) => field);
    return pick(row, fields);
  }

  function exportCsv(name, columns, rows) {
    const table = [columns.map(([, label]) => label), ...rows.map((row) => columns.map(([key]) => row[key] ?? ""))];
    download(name, `\uFEFF${table.map((row) => row.map(csv).join(",")).join("\n")}`, "text/csv;charset=utf-8");
  }

  function downloadJson(name, data) {
    download(name, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  }

  function download(name, text, type) {
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], { type }));
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.ImportExport = {
    workbookAvailable,
    readWorkbookDataset,
    downloadCurrentSheet,
    downloadTemplateWorkbook,
    exportWorkbook,
    escapeHtml,
  };
})(window);
