//! Unit tests for the AI proxy module.
//!
//! These tests exercise the pure-logic helper functions that do NOT require
//! network access or a running Tauri application:
//!
//!   - `validate_ai_url`      — URL scheme validation
//!   - `build_ai_headers`     — HTTP header construction
//!   - `ai_provider_status_error` — error formatting from HTTP status codes
//!   - `sanitize_audio_file_name` — file name normalisation for TTS output
//!
//! The Tauri command handlers (`ai_chat_completion`, `ai_get_json`,
//! `ai_transcribe_audio`, `ai_text_to_speech`) are thin wrappers around
//! `reqwest::Client` and are covered by integration / smoke tests elsewhere.

use mindzj_lib::api::ai_proxy::{
    ai_provider_status_error, build_ai_headers, sanitize_audio_file_name, validate_ai_url,
};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// validate_ai_url
// ---------------------------------------------------------------------------

mod validate_ai_url_tests {
    use super::*;

    // -- Happy paths (must accept) ------------------------------------------

    #[test]
    fn accepts_plain_http_url() {
        assert!(validate_ai_url("http://example.com:11434/api/chat").is_ok());
    }

    #[test]
    fn accepts_https_url() {
        assert!(validate_ai_url("https://api.openai.com/v1/chat/completions").is_ok());
    }

    #[test]
    fn accepts_https_with_port() {
        assert!(validate_ai_url("https://example.com:8443/v1/generate").is_ok());
    }

    #[test]
    fn accepts_http_with_path_and_query() {
        assert!(validate_ai_url("http://example.com:3000/api?key=secret").is_ok());
    }

    #[test]
    fn accepts_common_provider_urls() {
        // All major AI providers and local servers
        let urls = [
            "https://api.openai.com/v1/chat/completions",
            "https://api.anthropic.com/v1/messages",
            "https://generativelanguage.googleapis.com/v1/models",
            "https://my-instance.openai.azure.com/openai/deployments",
            "https://api.deepseek.com/v1/chat/completions",
            "https://api.groq.com/openai/v1/chat/completions",
            "https://api.together.xyz/v1/chat/completions",
            "http://example.com:8080/v1/chat/completions",
        ];
        for url in urls {
            assert!(validate_ai_url(url).is_ok(), "should accept: {url}");
        }
    }

    #[test]
    fn rejects_localhost() {
        let err = validate_ai_url("http://localhost:11434/api/chat").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_loopback_ip() {
        let err = validate_ai_url("http://127.0.0.1:3000/api").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_private_ip_10() {
        let err = validate_ai_url("http://10.0.0.1/api").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_private_ip_172() {
        let err = validate_ai_url("http://172.16.0.1/api").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_private_ip_192() {
        let err = validate_ai_url("http://192.168.1.100:8080/v1/chat").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_cloud_metadata() {
        let err = validate_ai_url("http://169.254.169.254/latest/meta-data/").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    // -- Rejection paths ----------------------------------------------------

    #[test]
    fn rejects_empty_string() {
        let err = validate_ai_url("").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        assert!(err.message.contains("http://"));
    }

    #[test]
    fn rejects_ftp_scheme() {
        let err = validate_ai_url("ftp://example.com/file").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_file_scheme() {
        let err = validate_ai_url("file:///etc/passwd").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_javascript_scheme() {
        let err = validate_ai_url("javascript:alert(1)").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_bare_hostname() {
        // No scheme at all — just a hostname
        let err = validate_ai_url("api.openai.com/v1/chat/completions").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_bare_path() {
        let err = validate_ai_url("/v1/chat/completions").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_http_prefix_that_is_not_a_scheme() {
        // "httpfoo" starts with "http" but not "http://"
        let err = validate_ai_url("httpfoo://bar").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn rejects_data_uri() {
        let err = validate_ai_url("data:text/plain,hello").unwrap_err();
        assert_eq!(err.code, "INVALID_AI_ENDPOINT");
    }

    #[test]
    fn error_message_contains_helpful_hint() {
        let err = validate_ai_url("ws://socket").unwrap_err();
        assert!(
            err.message.contains("http://") || err.message.contains("https://"),
            "error should hint at accepted schemes, got: {}",
            err.message
        );
    }
}

// ---------------------------------------------------------------------------
// build_ai_headers
// ---------------------------------------------------------------------------

mod build_ai_headers_tests {
    use super::*;
    use reqwest::header::{CONTENT_TYPE, HeaderValue};

    // -- Happy paths --------------------------------------------------------

    #[test]
    fn no_custom_headers_with_content_type() {
        let headers = build_ai_headers(None, true).unwrap();
        assert_eq!(
            headers.get(CONTENT_TYPE).unwrap(),
            HeaderValue::from_static("application/json")
        );
        assert_eq!(headers.len(), 1);
    }

    #[test]
    fn no_custom_headers_without_content_type() {
        let headers = build_ai_headers(None, false).unwrap();
        assert!(headers.is_empty());
    }

    #[test]
    fn custom_headers_are_included() {
        let mut custom = HashMap::new();
        custom.insert("Authorization".into(), "Bearer sk-test".into());
        custom.insert("X-Custom".into(), "value".into());

        let headers = build_ai_headers(Some(custom), false).unwrap();
        assert_eq!(
            headers.get("Authorization").unwrap(),
            HeaderValue::from_static("Bearer sk-test")
        );
        assert_eq!(
            headers.get("X-Custom").unwrap(),
            HeaderValue::from_static("value")
        );
        // No content-type because include_content_type=false
        assert!(headers.get(CONTENT_TYPE).is_none());
    }

    #[test]
    fn custom_headers_combined_with_content_type() {
        let mut custom = HashMap::new();
        custom.insert("Authorization".into(), "Bearer sk-key".into());

        let headers = build_ai_headers(Some(custom), true).unwrap();
        assert_eq!(
            headers.get(CONTENT_TYPE).unwrap(),
            HeaderValue::from_static("application/json")
        );
        assert_eq!(
            headers.get("Authorization").unwrap(),
            HeaderValue::from_static("Bearer sk-key")
        );
        assert_eq!(headers.len(), 2);
    }

    #[test]
    fn empty_custom_headers_map_with_content_type() {
        let headers = build_ai_headers(Some(HashMap::new()), true).unwrap();
        assert_eq!(
            headers.get(CONTENT_TYPE).unwrap(),
            HeaderValue::from_static("application/json")
        );
        assert_eq!(headers.len(), 1);
    }

    #[test]
    fn anthropic_specific_headers() {
        // Anthropic uses x-api-key instead of Authorization
        let mut custom = HashMap::new();
        custom.insert("x-api-key".into(), "sk-ant-test".into());
        custom.insert("anthropic-version".into(), "2023-06-01".into());

        let headers = build_ai_headers(Some(custom), true).unwrap();
        assert_eq!(
            headers.get("x-api-key").unwrap(),
            HeaderValue::from_static("sk-ant-test")
        );
        assert_eq!(
            headers.get("anthropic-version").unwrap(),
            HeaderValue::from_static("2023-06-01")
        );
    }

    #[test]
    fn ollama_typically_no_auth_headers() {
        // Ollama usually needs no auth, just content type
        let headers = build_ai_headers(None, true).unwrap();
        assert!(headers.get("Authorization").is_none());
        assert_eq!(
            headers.get(CONTENT_TYPE).unwrap(),
            HeaderValue::from_static("application/json")
        );
    }

    // -- Error paths --------------------------------------------------------

    #[test]
    fn invalid_header_name_returns_error() {
        let mut custom = HashMap::new();
        // Header names cannot contain spaces
        custom.insert("Bad Header".into(), "value".into());

        let err = build_ai_headers(Some(custom), false).unwrap_err();
        assert_eq!(err.code, "INVALID_AI_HEADER");
    }

    #[test]
    fn invalid_header_value_returns_error() {
        let mut custom = HashMap::new();
        // Header values cannot contain newlines (header injection)
        custom.insert("Authorization".into(), "Bearer\nInjected".into());

        let err = build_ai_headers(Some(custom), false).unwrap_err();
        assert_eq!(err.code, "INVALID_AI_HEADER");
    }

    #[test]
    fn empty_header_name_returns_error() {
        let mut custom = HashMap::new();
        custom.insert("".into(), "value".into());

        let err = build_ai_headers(Some(custom), false).unwrap_err();
        assert_eq!(err.code, "INVALID_AI_HEADER");
    }

    #[test]
    fn first_invalid_header_stops_iteration() {
        // If there are multiple custom headers, the first bad one should be
        // the one reported (HashMap iteration order may vary, but we should
        // get *an* error).
        let mut custom = HashMap::new();
        custom.insert("Good-Header".into(), "ok".into());
        custom.insert("Bad\x01Header".into(), "value".into());

        let err = build_ai_headers(Some(custom), false).unwrap_err();
        assert_eq!(err.code, "INVALID_AI_HEADER");
    }
}

// ---------------------------------------------------------------------------
// ai_provider_status_error
// ---------------------------------------------------------------------------

mod ai_provider_status_error_tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn formats_400_bad_request() {
        let err = ai_provider_status_error(
            StatusCode::BAD_REQUEST,
            "invalid request body".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "400: invalid request body");
    }

    #[test]
    fn formats_401_unauthorized() {
        let err = ai_provider_status_error(
            StatusCode::UNAUTHORIZED,
            "Invalid API key".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "401: Invalid API key");
    }

    #[test]
    fn formats_403_forbidden() {
        let err = ai_provider_status_error(
            StatusCode::FORBIDDEN,
            "Access denied".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "403: Access denied");
    }

    #[test]
    fn formats_404_not_found() {
        let err = ai_provider_status_error(
            StatusCode::NOT_FOUND,
            "Model not found".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "404: Model not found");
    }

    #[test]
    fn formats_429_rate_limited() {
        let err = ai_provider_status_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Rate limit exceeded".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "429: Rate limit exceeded");
    }

    #[test]
    fn formats_500_server_error() {
        let err = ai_provider_status_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal error".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "500: Internal error");
    }

    #[test]
    fn formats_502_bad_gateway() {
        let err = ai_provider_status_error(
            StatusCode::BAD_GATEWAY,
            "".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        // Empty text — no colon separator
        assert_eq!(err.message, "502");
    }

    #[test]
    fn empty_text_omits_separator() {
        let err = ai_provider_status_error(
            StatusCode::SERVICE_UNAVAILABLE,
            String::new(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "503");
    }

    #[test]
    fn nonempty_text_includes_separator() {
        let err = ai_provider_status_error(
            StatusCode::from_u16(418).unwrap(),
            "I'm a teapot".into(),
        );
        assert_eq!(err.code, "AI_PROVIDER_ERROR");
        assert_eq!(err.message, "418: I'm a teapot");
    }

    #[test]
    fn all_errors_share_ai_provider_error_code() {
        // The code is always AI_PROVIDER_ERROR regardless of status
        let codes: Vec<_> = [400u16, 401, 403, 404, 429, 500, 502, 503]
            .iter()
            .map(|&s| {
                ai_provider_status_error(StatusCode::from_u16(s).unwrap(), "x".into()).code
            })
            .collect();
        assert!(codes.iter().all(|c| c == "AI_PROVIDER_ERROR"));
    }
}

// ---------------------------------------------------------------------------
// sanitize_audio_file_name
// ---------------------------------------------------------------------------

mod sanitize_audio_file_name_tests {
    use super::*;

    // -- Happy paths --------------------------------------------------------

    #[test]
    fn valid_name_preserved() {
        let result = sanitize_audio_file_name(Some("my-audio.mp3".into()));
        assert_eq!(result, "my-audio.mp3");
    }

    #[test]
    fn valid_name_without_mp3_gets_extension() {
        let result = sanitize_audio_file_name(Some("my-audio".into()));
        assert_eq!(result, "my-audio.mp3");
    }

    #[test]
    fn name_with_mp3_uppercase_gets_normalized() {
        // The function checks .to_ascii_lowercase().ends_with(".mp3")
        let result = sanitize_audio_file_name(Some("my-audio.MP3".into()));
        assert_eq!(result, "my-audio.MP3");
    }

    #[test]
    fn special_chars_replaced_with_underscores() {
        let result = sanitize_audio_file_name(Some("my audio file!.mp3".into()));
        // spaces and ! become _
        assert_eq!(result, "my_audio_file_.mp3");
    }

    #[test]
    fn dots_and_hyphens_preserved() {
        let result = sanitize_audio_file_name(Some("v1.2-beta.mp3".into()));
        assert_eq!(result, "v1.2-beta.mp3");
    }

    #[test]
    fn leading_dots_stripped() {
        let result = sanitize_audio_file_name(Some("..hidden.mp3".into()));
        assert_eq!(result, "hidden.mp3");
    }

    #[test]
    fn leading_underscores_stripped() {
        let result = sanitize_audio_file_name(Some("__internal.mp3".into()));
        assert_eq!(result, "internal.mp3");
    }

    #[test]
    fn unicode_chars_replaced() {
        let result = sanitize_audio_file_name(Some("résumé.mp3".into()));
        // non-ASCII chars become _
        assert_eq!(result, "r_sum_.mp3");
    }

    // -- Edge cases ---------------------------------------------------------

    #[test]
    fn none_returns_fallback_with_timestamp() {
        let result = sanitize_audio_file_name(None);
        assert!(result.starts_with("mindzj_grok_tts_"));
        assert!(result.ends_with(".mp3"));
    }

    #[test]
    fn empty_string_returns_fallback() {
        let result = sanitize_audio_file_name(Some("".into()));
        assert!(result.starts_with("mindzj_grok_tts_"));
        assert!(result.ends_with(".mp3"));
    }

    #[test]
    fn whitespace_only_returns_fallback() {
        // Whitespace chars are all replaced with _, then leading _ stripped
        let result = sanitize_audio_file_name(Some("   ".into()));
        // "   " -> "___" -> stripped -> "" -> fallback
        assert!(result.starts_with("mindzj_grok_tts_"));
        assert!(result.ends_with(".mp3"));
    }

    #[test]
    fn only_special_chars_returns_fallback() {
        // All chars replaced with _, then all stripped -> empty -> fallback
        let result = sanitize_audio_file_name(Some("!!!".into()));
        assert!(result.starts_with("mindzj_grok_tts_"));
        assert!(result.ends_with(".mp3"));
    }

    #[test]
    fn only_dots_returns_fallback() {
        // "." is preserved but leading dots are stripped
        let result = sanitize_audio_file_name(Some("...".into()));
        // "...". chars: each '.' is preserved -> "..."
        // leading dots stripped -> "" -> fallback
        assert!(result.starts_with("mindzj_grok_tts_"));
        assert!(result.ends_with(".mp3"));
    }

    #[test]
    fn mp3_extension_not_doubled() {
        let result = sanitize_audio_file_name(Some("output.mp3".into()));
        assert_eq!(result, "output.mp3");
        // Should NOT be "output.mp3.mp3"
        assert!(!result.contains(".mp3.mp3"));
    }

    #[test]
    fn non_mp3_extension_gets_mp3_appended() {
        let result = sanitize_audio_file_name(Some("output.wav".into()));
        assert_eq!(result, "output.wav.mp3");
    }

    #[test]
    fn long_name_preserved() {
        let long_name = format!("{}.mp3", "a".repeat(200));
        let result = sanitize_audio_file_name(Some(long_name.clone()));
        assert_eq!(result, long_name);
    }

    // -- Provider detection / URL family tests ------------------------------
    //
    // The proxy itself is provider-agnostic: it accepts any http/https URL
    // and forwards requests transparently. There is no explicit "provider
    // detection" function. What we CAN test is that URLs belonging to
    // different provider families all pass URL validation — confirming the
    // proxy does not accidentally reject a specific provider.

    #[test]
    fn provider_family_urls_all_accepted() {
        let provider_urls = [
            // OpenAI
            "https://api.openai.com/v1/chat/completions",
            // Anthropic (via OpenAI-compatible proxy or direct)
            "https://api.anthropic.com/v1/messages",
            // Google Gemini
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
            // Azure OpenAI
            "https://my-resource.openai.azure.com/openai/deployments/my-model/chat/completions?api-version=2024-02-15-preview",
            // Groq
            "https://api.groq.com/openai/v1/chat/completions",
            // Together AI
            "https://api.together.xyz/v1/chat/completions",
            // DeepSeek
            "https://api.deepseek.com/v1/chat/completions",
            // Mistral
            "https://api.mistral.ai/v1/chat/completions",
            // Cohere
            "https://api.cohere.ai/v1/chat",
            // Custom endpoint
            "http://example.com:8080/v1/chat/completions",
        ];

        for url in provider_urls {
            assert!(
                validate_ai_url(url).is_ok(),
                "provider URL should be accepted: {url}"
            );
        }
    }
}
