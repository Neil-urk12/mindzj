use thiserror::Error;

/// Central error type for all kernel operations.
/// Each variant maps to a specific failure domain, making error handling
/// precise and debuggable across the entire backend.
#[derive(Error, Debug)]
pub enum KernelError {
    #[error("Vault not found: {0}")]
    VaultNotFound(String),

    #[error("Vault already open: {0}")]
    VaultAlreadyOpen(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("File already exists: {0}")]
    FileAlreadyExists(String),

    #[error("Path traversal denied: {0}")]
    PathTraversalDenied(String),

    #[error("Invalid file name: {0}")]
    InvalidFileName(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Index error: {0}")]
    Index(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error("AI provider error: {0}")]
    AiProvider(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("File too large: {0}")]
    FileTooLarge(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

pub type KernelResult<T> = Result<T, KernelError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_error_display() {
        let err = KernelError::VaultNotFound("test".into());
        assert_eq!(err.to_string(), "Vault not found: test");

        let err = KernelError::FileNotFound("test".into());
        assert_eq!(err.to_string(), "File not found: test");
    }

    #[test]
    fn kernel_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        let err: KernelError = io_err.into();
        assert!(err.to_string().contains("gone"));
    }

    #[test]
    fn kernel_result_type_alias() {
        let ok: KernelResult<i32> = Ok(42);
        assert_eq!(ok.unwrap(), 42);
    }
}
