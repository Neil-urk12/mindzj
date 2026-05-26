use serde::Serialize;

// Re-export KernelError from the shared kernel crate
pub use mindzj_kernel::KernelError;
pub use mindzj_kernel::KernelResult;

/// Serializable error wrapper for Tauri command responses.
/// Tauri requires command errors to implement `Serialize` so they
/// can cross the IPC boundary to the frontend.
#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<KernelError> for CommandError {
    fn from(err: KernelError) -> Self {
        let code = match &err {
            KernelError::VaultNotFound(_) => "VAULT_NOT_FOUND",
            KernelError::VaultAlreadyOpen(_) => "VAULT_ALREADY_OPEN",
            KernelError::FileNotFound(_) => "FILE_NOT_FOUND",
            KernelError::FileAlreadyExists(_) => "FILE_ALREADY_EXISTS",
            KernelError::PathTraversalDenied(_) => "PATH_TRAVERSAL_DENIED",
            KernelError::InvalidFileName(_) => "INVALID_FILE_NAME",
            KernelError::Io(_) => "IO_ERROR",
            KernelError::Database(_) => "DATABASE_ERROR",
            KernelError::Index(_) => "INDEX_ERROR",
            KernelError::Serialization(_) => "SERIALIZATION_ERROR",
            KernelError::AuthFailed(_) => "AUTH_FAILED",
            KernelError::PermissionDenied(_) => "PERMISSION_DENIED",
            KernelError::Plugin(_) => "PLUGIN_ERROR",
            KernelError::AiProvider(_) => "AI_PROVIDER_ERROR",
            KernelError::Config(_) => "CONFIG_ERROR",
            KernelError::FileTooLarge(_) => "FILE_TOO_LARGE",
            KernelError::InvalidInput(_) => "INVALID_INPUT",
        };

        CommandError {
            code: code.into(),
            message: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(err: serde_json::Error) -> Self {
        CommandError {
            code: "SERIALIZATION_ERROR".into(),
            message: err.to_string(),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        CommandError {
            code: "IO_ERROR".into(),
            message: err.to_string(),
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}
