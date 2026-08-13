use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NoteSummary {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) tags: Vec<String>,
    pub(crate) updated: u64,
    #[serde(skip_serializing)]
    pub(crate) searchable_text: String,
    pub(crate) excerpt: String,
    pub(crate) folder: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum IndexWarningKind {
    Walk,
    UnreadableMarkdown,
    InvalidMetadata,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct IndexWarning {
    pub(crate) path: String,
    pub(crate) kind: IndexWarningKind,
}

#[derive(Clone, Serialize)]
pub(crate) struct LibrarySnapshot {
    pub(crate) notes: Vec<NoteSummary>,
    pub(crate) folders: Vec<String>,
    pub(crate) trash: Vec<NoteSummary>,
    pub(crate) warnings: Vec<IndexWarning>,
}

#[derive(Serialize)]
pub(crate) struct FolderRenamePath {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Serialize)]
pub(crate) struct FolderRenameResult {
    pub(crate) folder: String,
    pub(crate) paths: Vec<FolderRenamePath>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NoteDocument {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) tags: Vec<String>,
    pub(crate) body: String,
    pub(crate) updated: u64,
    pub(crate) revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) updated_at: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct ImportedImage {
    pub(crate) markdown_path: String,
    pub(crate) alt: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum SaveNoteResult {
    Saved { note: NoteDocument },
    Conflict { disk: NoteDocument },
    Error { message: String },
}
