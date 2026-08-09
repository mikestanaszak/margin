import React, { useState } from "react";
import type { MarkdownTable } from "../../note-utils";

export function TableDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (rows: number, columns: number) => void;
}) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  return (
    <div className="modal-backdrop">
      <form
        className="modal table-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onInsert(rows, columns);
        }}
      >
        <h2>Insert table</h2>
        <p>Create the Markdown structure, then type directly into the cells.</p>
        <label>
          Columns
          <input
            type="number"
            min="1"
            max="8"
            value={columns}
            onChange={(event) => setColumns(Number(event.target.value))}
          />
        </label>
        <label>
          Rows
          <input
            type="number"
            min="1"
            max="12"
            value={rows}
            onChange={(event) => setRows(Number(event.target.value))}
          />
        </label>
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Insert table</button>
        </div>
      </form>
    </div>
  );
}
export function TableEditorDialog({
  table,
  onClose,
  onApply,
}: {
  table: MarkdownTable;
  onClose: () => void;
  onApply: (headers: string[], rows: string[][]) => void;
}) {
  const [headers, setHeaders] = useState(table.headers);
  const [rows, setRows] = useState(table.rows);
  const move = <T,>(items: T[], from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  const changeHeader = (index: number, value: string) =>
    setHeaders((current) =>
      current.map((cell, cellIndex) => (cellIndex === index ? value : cell)),
    );
  const changeCell = (row: number, column: number, value: string) =>
    setRows((current) =>
      current.map((cells, rowIndex) =>
        rowIndex === row
          ? cells.map((cell, columnIndex) =>
              columnIndex === column ? value : cell,
            )
          : cells,
      ),
    );
  const addColumn = (at = headers.length) => {
    if (headers.length >= 12) return;
    setHeaders((current) => [
      ...current.slice(0, at),
      `Column ${current.length + 1}`,
      ...current.slice(at),
    ]);
    setRows((current) =>
      current.map((row) => [...row.slice(0, at), "", ...row.slice(at)]),
    );
  };
  const removeColumn = (column: number) => {
    if (headers.length <= 1) return;
    setHeaders((current) => current.filter((_, index) => index !== column));
    setRows((current) =>
      current.map((row) => row.filter((_, index) => index !== column)),
    );
  };
  const moveColumn = (from: number, to: number) => {
    if (from === to) return;
    setHeaders((current) => move(current, from, to));
    setRows((current) => current.map((row) => move(row, from, to)));
  };
  const addRow = (at = rows.length) => {
    if (rows.length >= 50) return;
    setRows((current) => [
      ...current.slice(0, at),
      headers.map(() => ""),
      ...current.slice(at),
    ]);
  };
  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    setRows((current) => move(current, from, to));
  };
  const pointerReorder = (
    event: React.PointerEvent<HTMLButtonElement>,
    from: number,
    selector: string,
    reorder: (from: number, to: number) => void,
  ) => {
    event.preventDefault();
    let current = from;
    const onMove = (moveEvent: PointerEvent) => {
      const target = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest<HTMLElement>(selector);
      const targetIndex = Number(target?.dataset.index);
      if (
        !Number.isInteger(targetIndex) ||
        targetIndex < 0 ||
        targetIndex === current
      )
        return;
      reorder(current, targetIndex);
      current = targetIndex;
    };
    const onStop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop, { once: true });
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal table-editor-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(headers, rows);
        }}
      >
        <header>
          <div>
            <h2>Edit table</h2>
            <p>
              Drag ⠿ to reorder. Use ＋ beside a row or column to add after
              it.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close table editor"
            onClick={onClose}
          >
          ×
          </button>
        </header>
        <div className="table-grid-wrap">
          <table className="table-editor-grid">
            <thead>
              <tr>
                <th className="table-drag-column" />
                {headers.map((header, column) => (
                  <th key={column} data-table-column data-index={column}>
                    <button
                      type="button"
                      className="table-drag-handle"
                      aria-label={`Drag column ${column + 1}`}
                      title="Drag to reorder column"
                      onPointerDown={(event) =>
                        pointerReorder(
                          event,
                          column,
                          "[data-table-column]",
                          moveColumn,
                        )
                      }
                    >
                      ⠿
                    </button>
                    <input
                      aria-label={`Header ${column + 1}`}
                      value={header}
                      onChange={(event) =>
                        changeHeader(column, event.target.value)
                      }
                    />
                    <span className="table-column-actions">
                      <button
                        type="button"
                        title={`Add column after ${column + 1}`}
                        aria-label={`Add column after ${column + 1}`}
                        onClick={() => addColumn(column + 1)}
                      >
                        ＋
                      </button>
                      <button
                        type="button"
                        title={`Delete column ${column + 1}`}
                        aria-label={`Delete column ${column + 1}`}
                        disabled={headers.length <= 1}
                        onClick={() => removeColumn(column)}
                      >
                        ×
                      </button>
                    </span>
                  </th>
                ))}
                <th className="table-row-action" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} data-table-row data-index={rowIndex}>
                  <td className="table-drag-column">
                    <button
                      type="button"
                      className="table-drag-handle"
                      aria-label={`Drag row ${rowIndex + 1}`}
                      title="Drag to reorder row"
                      onPointerDown={(event) =>
                        pointerReorder(
                          event,
                          rowIndex,
                          "[data-table-row]",
                          moveRow,
                        )
                      }
                    >
                      ⠿
                    </button>
                  </td>
                  {headers.map((_, column) => (
                    <td key={column}>
                      <input
                        aria-label={`Row ${rowIndex + 1}, column ${column + 1}`}
                        value={row[column] || ""}
                        onChange={(event) =>
                          changeCell(rowIndex, column, event.target.value)
                        }
                      />
                    </td>
                  ))}
                  <td className="table-row-action">
                    <button
                      type="button"
                      className="table-add-after"
                      title={`Add row after ${rowIndex + 1}`}
                      aria-label={`Add row after ${rowIndex + 1}`}
                      onClick={() => addRow(rowIndex + 1)}
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      className="table-remove"
                      title={`Delete row ${rowIndex + 1}`}
                      aria-label={`Delete row ${rowIndex + 1}`}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, index) => index !== rowIndex),
                        )
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-editor-actions">
          <span />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Apply changes</button>
        </div>
      </form>
    </div>
  );
}
