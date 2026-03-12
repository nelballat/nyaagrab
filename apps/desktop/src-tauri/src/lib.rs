use std::{fs, process::Command, sync::OnceLock, time::Duration};
use tokio::time::sleep;

use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT},
    Client,
};
use rfd::FileDialog;
use serde::Serialize;

#[derive(Serialize)]
struct TextResponse {
    text: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct TitleResponse {
    titles: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct SavedFileResponse {
    path: String,
}

static NYAA_CLIENT: OnceLock<Client> = OnceLock::new();
static ANILIST_CLIENT: OnceLock<Client> = OnceLock::new();

fn build_nyaa_client() -> Result<Client, reqwest::Error> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("nyaagrab/0.1.0 (desktop)"));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"),
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .http1_only()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .tcp_keepalive(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
}

fn nyaa_client() -> Result<&'static Client, String> {
    if let Some(client) = NYAA_CLIENT.get() {
        return Ok(client);
    }

    let client = build_nyaa_client().map_err(|error| format!("client build failed: {error:#}"))?;
    let _ = NYAA_CLIENT.set(client);
    NYAA_CLIENT
        .get()
        .ok_or_else(|| "client initialization failed".to_string())
}

#[tauri::command]
async fn fetch_nyaa_rss(query: String, category: String, filter: String) -> TextResponse {
    let client = match nyaa_client() {
        Ok(client) => client,
        Err(error) => {
            return TextResponse {
                text: None,
                error: Some(error),
            }
        }
    };

    let mut last_error: Option<String> = None;

    for attempt in 1..=3 {
        if attempt > 1 {
            sleep(Duration::from_millis(500)).await;
        }

        let response = client
            .get("https://nyaa.si/")
            .query(&[
                ("page", "rss"),
                ("q", query.as_str()),
                ("c", category.as_str()),
                ("f", filter.as_str()),
                ("p", "1"),
            ])
            .send()
            .await;

        match response {
            Ok(response) => {
                let status = response.status();
                let response = match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        let msg = format!("request failed on attempt {attempt}: {error:#}");
                        if status.as_u16() == 429 {
                            return TextResponse {
                                text: None,
                                error: Some(msg),
                            };
                        }
                        last_error = Some(msg);
                        continue;
                    }
                };

                return match response.text().await {
                    Ok(text) => TextResponse {
                        text: Some(text),
                        error: None,
                    },
                    Err(error) => TextResponse {
                        text: None,
                        error: Some(format!("read failed on attempt {attempt}: {error:#}")),
                    },
                };
            }
            Err(error) => {
                last_error = Some(format!("request failed on attempt {attempt}: {error:#}"));
            }
        }
    }

    TextResponse {
        text: None,
        error: last_error,
    }
}

#[tauri::command]
async fn resolve_anilist_titles(name: String) -> TitleResponse {
    let client = match ANILIST_CLIENT.get() {
        Some(client) => client,
        None => {
            let built = match reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()
            {
                Ok(client) => client,
                Err(error) => {
                    return TitleResponse {
                        titles: vec![],
                        error: Some(format!("client build failed: {error:#}")),
                    }
                }
            };
            let _ = ANILIST_CLIENT.set(built);
            ANILIST_CLIENT.get().unwrap()
        }
    };
    let payload = serde_json::json!({
        "query": "query($search: String) { Media(search: $search, type: ANIME) { title { romaji english native } } }",
        "variables": { "search": name }
    });

    let response = match client
        .post("https://graphql.anilist.co")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return TitleResponse {
                titles: vec![],
                error: Some(format!("request failed: {error}")),
            }
        }
    };

    let value: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(error) => {
            return TitleResponse {
                titles: vec![],
                error: Some(format!("json failed: {error}")),
            }
        }
    };

    let media = &value["data"]["Media"];
    if media.is_null() {
        return TitleResponse {
            titles: vec![],
            error: None,
        };
    }

    let mut titles = vec![];
    for key in ["romaji", "english", "native"] {
        if let Some(title) = media["title"][key].as_str() {
            titles.push(title.to_string());
        }
    }

    TitleResponse { titles, error: None }
}

#[tauri::command]
fn save_magnet_file(filename_hint: String, content: String) -> Result<SavedFileResponse, String> {
    let path = FileDialog::new()
        .set_file_name(&filename_hint)
        .save_file()
        .ok_or_else(|| "save cancelled".to_string())?;

    fs::write(&path, content).map_err(|error| format!("write failed: {error}"))?;

    Ok(SavedFileResponse {
        path: path.display().to_string(),
    })
}

#[tauri::command]
fn open_target(target: String) -> Result<(), String> {
    if !target.starts_with("magnet:")
        && !target.starts_with("http://")
        && !target.starts_with("https://")
    {
        return Err("blocked: target must use magnet:, http://, or https:// scheme".to_string());
    }

    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &target])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&target).spawn();

    result.map(|_| ()).map_err(|error| format!("open failed: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_nyaa_rss,
            resolve_anilist_titles,
            save_magnet_file,
            open_target
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
