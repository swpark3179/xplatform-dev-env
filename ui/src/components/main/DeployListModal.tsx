import React, { useRef, useState } from "react";
import { Modal } from "../common";
import { AppActions, AppState } from "@/hooks/useAppState";

export const DeployListModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  actions: AppActions;
}> = ({ isOpen, onClose, state, actions }) => {
  const [isJavaOpen, setIsJavaOpen] = useState(true);
  const [isQueryOpen, setIsQueryOpen] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const searchPaneRef = useRef<HTMLDivElement>(null);
  const deployFileIndex = state.deploy.deployFileIndex;

  // 검색 도구 영역 밖 클릭 시 검색어·결과 초기화 (드롭다운 닫기)
  React.useEffect(() => {
    if (!isOpen || searchKeyword.trim().length === 0) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchPaneRef.current &&
        !searchPaneRef.current.contains(e.target as Node)
      ) {
        setSearchKeyword("");
        actions.deploy.clearSearchResult();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, searchKeyword, actions.deploy]);

  // 새로고침 버튼 클릭 핸들러
  const handleRefreshDeployableFiles = () => {
    actions.deploy.refreshDeployFileIndex();
  };

  // 검색어 입력 변경 핸들러 (메모리에서 로컬 필터링)
  React.useEffect(() => {
    if (!isOpen) return;
    if (searchKeyword.trim() === "") {
      actions.deploy.clearSearchResult();
    } else {
      // 대소문자 구분 없이 검색
      const lowerKeyword = searchKeyword.toLowerCase();
      const selectedFiles = new Set([
        ...state.deploy.deployFileList.java,
        ...state.deploy.deployFileList.query,
      ]);
      const allFiles = state.deploy.allDeployableFiles || [];
      const filtered = allFiles.filter(
        (file) =>
          !selectedFiles.has(file) && file.toLowerCase().includes(lowerKeyword),
      );
      actions.deploy.setStateSearchResult(filtered);
    }
  }, [
    searchKeyword,
    isOpen,
    state.deploy.allDeployableFiles,
    state.deploy.deployFileList.java,
    state.deploy.deployFileList.query,
    actions.deploy,
  ]);

  // 참조 체인 분석 완료 시 로딩 상태 해제
  React.useEffect(() => {
    if (!isOpen) return;
    const prevList = state.deploy.deployFileList.java;
    setIsAnalyzing(false);
    return () => {
      void prevList;
    };
  }, [state.deploy.deployFileList.java, isOpen]);

  // 검색 결과에서 파일을 배포 목록으로 추가
  const handleAdd = (fileToAdd: string) => {
    let type: "java" | "query" | null = null;
    if (fileToAdd.includes("/src/java/")) {
      type = "java";
    } else if (fileToAdd.includes("/src/query/")) {
      type = "query";
    }
    if (!type) return;

    const currentList = state.deploy.deployFileList[type];
    if (currentList.includes(fileToAdd)) return;
    const updatedList = [...currentList, fileToAdd];
    const newDeployFileList = {
      ...state.deploy.deployFileList,
      [type]: updatedList,
    };
    actions.deploy.updateDeployFiles(
      newDeployFileList,
      fileToAdd,
      type,
      "add",
    );
    // 검색 결과에서 해당 파일 제거 (재조회)
    actions.deploy.setStateSearchResult(
      state.deploy.searchResult.filter((item) => item !== fileToAdd),
    );
  };

  // 전체 파일경로에서 실제 파일명만 추출
  const getFileName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  // 전체 파일경로에서, src 하위 경로만 추출
  const getTooltip = (path: string) => {
    const srcIndex = path.indexOf("/src/");
    if (srcIndex !== -1) {
      return path.substring(srcIndex);
    }
    return path;
  };

  const getIndexStatusText = () => {
    if (deployFileIndex.status === "indexing") {
      const phaseLabel =
        deployFileIndex.phase === "java"
          ? "Java"
          : deployFileIndex.phase === "query"
            ? "Query"
            : "파일";
      return `인덱싱 중: ${phaseLabel} 수집 중 · Java ${deployFileIndex.javaCount} / Query ${deployFileIndex.queryCount} / 총 ${deployFileIndex.indexedCount}`;
    }
    if (deployFileIndex.status === "error") {
      return deployFileIndex.errorMessage || "인덱싱에 실패했습니다.";
    }
    if (deployFileIndex.status === "ready") {
      const completedAt = deployFileIndex.lastCompletedAt
        ? new Date(deployFileIndex.lastCompletedAt).toLocaleTimeString()
        : null;
      return completedAt
        ? `인덱싱 완료: Java ${deployFileIndex.javaCount} / Query ${deployFileIndex.queryCount} / 총 ${deployFileIndex.indexedCount} (${completedAt})`
        : `인덱싱 완료: Java ${deployFileIndex.javaCount} / Query ${deployFileIndex.queryCount} / 총 ${deployFileIndex.indexedCount}`;
    }
    return "인덱싱 대기 중";
  };

  // 배포 목록에서 대상 파일을 제거
  const handleRemove = (type: "java" | "query", fileToRemove: string) => {
    const currentList = state.deploy.deployFileList[type];
    const updatedList = currentList.filter((f) => f !== fileToRemove);
    const newDeployFiles = {
      ...state.deploy.deployFileList,
      [type]: updatedList,
    };
    actions.deploy.updateDeployFiles(
      newDeployFiles,
      fileToRemove,
      type,
      "remove",
    );
  };

  // 참조 클래스 자동 추가 핸들러
  const handleAnalyzeReferenceChain = () => {
    const javaFiles = state.deploy.deployFileList.java;
    if (javaFiles.length === 0 || isAnalyzing) {
      return;
    }
    setIsAnalyzing(true);
    actions.deploy.analyzeReferenceChain(javaFiles);
  };

  return (
    <Modal
      isOpen={isOpen}
      title="배포 목록 관리"
      onClose={onClose}
      onConfirm={onClose}
      confirmText="닫기"
      hideCancel={true}
      position={{ left: 0, top: 50 }}
    >
      <div
        className="deploy-list-layout"
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        {/* 검색 도구 영역 */}
          <div
            ref={searchPaneRef}
            className="search-pane"
            style={{ display: "flex", flexDirection: "column", gap: "5px" }}
          >
            <div
              style={{
                fontSize: "11px",
                color:
                  deployFileIndex.status === "error"
                    ? "var(--vscode-errorForeground)"
                    : "var(--vscode-descriptionForeground)",
              }}
            >
              {getIndexStatusText()}
            </div>
            <div style={{ display: "flex", gap: "5px", position: "relative" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <div style={{ position: "relative", width: "100%" }}>
                <input
                  type="text"
                  placeholder={"추가할 파일명 검색... (Java 및 Query)"}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  style={{ width: "100%", paddingRight: searchKeyword ? '24px' : undefined, boxSizing: 'border-box' }}
                />
                {searchKeyword && (
                  <button
                    type="button"
                    onClick={() => { setSearchKeyword(""); actions.deploy.clearSearchResult(); }}
                    aria-label="검색어 지우기"
                    title="검색어 지우기"
                    style={{
                      position: 'absolute',
                      right: '4px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--vscode-input-foreground, #ccc)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      fontSize: '14px',
                      opacity: 0.7
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {searchKeyword.trim().length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  border: "1px solid var(--vscode-panel-border)",
                  maxHeight: "200px",
                  overflowY: "auto",
                  backgroundColor: "var(--vscode-editor-background)",
                  boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
                  marginTop: "4px",
                }}
              >
                {state.deploy.searchResult.length === 0 ? (
                  <div
                    style={{
                      padding: "8px",
                      color: "var(--vscode-descriptionForeground)",
                      fontSize: "11px",
                      textAlign: "center",
                    }}
                  >
                    검색 결과가 없습니다.
                  </div>
                ) : (
                  state.deploy.searchResult.map(
                    (file, idx) =>
                      !state.tomcat.running && (
                        <div
                          key={idx}
                          className="tree-item"
                          title={getTooltip(file)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 8px",
                            cursor: "pointer",
                            borderBottom:
                              "1px solid var(--vscode-panel-border)",
                          }}
                          onClick={() => handleAdd(file)}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {getFileName(file)}
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "10px",
                                color: "var(--vscode-descriptionForeground)",
                              }}
                            >
                              {file.includes("/src/java/")
                                ? "(Java)"
                                : "(Query)"}
                            </span>
                          </span>
                          <button
                            title={`${getFileName(file)} 추가`}
                            aria-label={`${getFileName(file)} 추가`}
                            className="icon-btn tree-item-action"
                            style={{
                              width: "20px",
                              height: "20px",
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              padding: 0,
                            }}
                          >
                            +
                          </button>
                        </div>
                      ),
                  )
                )}
              </div>
              )}
            </div>
            <button
              title="파일 목록 새로고침"
              aria-label="파일 목록 새로고침"
              onClick={handleRefreshDeployableFiles}
              disabled={deployFileIndex.status === "indexing"}
              style={{
                fontSize: "12px",
                padding: "0 8px",
                cursor:
                  deployFileIndex.status === "indexing"
                    ? "not-allowed"
                    : "pointer",
                opacity: deployFileIndex.status === "indexing" ? 0.6 : 1,
                background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, #ccc)",
                border: "1px solid var(--vscode-panel-border)",
                borderRadius: "3px",
                whiteSpace: "nowrap",
              }}
            >
              {deployFileIndex.status === "indexing" ? "⏳" : "🔄"}
            </button>
          </div>
        </div>

        {/* 등록된 파일 목록 영역 */}
        <div
          className="list-pane"
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px",
            }}
          >
            <h5 style={{ margin: 0 }}>현재 배포 목록</h5>
            {!state.tomcat.running && (
              <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
                <button
                  title="배포 목록의 Java 파일에서 참조하는 클래스를 재귀적으로 탐색해 목록에 추가합니다"
                  aria-label="배포 목록의 Java 파일에서 참조하는 클래스를 재귀적으로 탐색해 목록에 추가합니다"
                  disabled={
                    state.deploy.deployFileList.java.length === 0 || isAnalyzing
                  }
                  onClick={handleAnalyzeReferenceChain}
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    cursor:
                      state.deploy.deployFileList.java.length === 0 ||
                      isAnalyzing
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      state.deploy.deployFileList.java.length === 0 ||
                      isAnalyzing
                        ? 0.5
                        : 1,
                    background:
                      "var(--vscode-button-secondaryBackground, #3a3d41)",
                    color: "var(--vscode-button-secondaryForeground, #ccc)",
                    border: "1px solid var(--vscode-panel-border)",
                    borderRadius: "3px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isAnalyzing ? "⏳ 분석 중..." : "🔗 참조 자동등록"}
                </button>
                <button
                  title="배포 목록 초기화"
                  aria-label="배포 목록 초기화"
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    background:
                      "var(--vscode-button-secondaryBackground, #3a3d41)",
                    color: "var(--vscode-button-secondaryForeground, #ccc)",
                    border: "1px solid var(--vscode-panel-border)",
                    borderRadius: "3px",
                  }}
                  onClick={actions.deploy.clearDeployFiles}
                >
                  🔄 초기화
                </button>
              </div>
            )}
          </div>
          <div
            className="tree-view-container"
            style={{
              border: "1px solid var(--vscode-panel-border)",
              height: "170px",
              overflowY: "auto",
              backgroundColor: "var(--vscode-sideBar-background)",
              color: "var(--vscode-sideBar-foreground)",
              margin: 0,
            }}
          >
            {/* Java Section */}
            <div className="tree-section">
              <div
                className="tree-header"
                role="button"
                tabIndex={0}
                aria-expanded={isJavaOpen}
                onClick={() => setIsJavaOpen(!isJavaOpen)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsJavaOpen(!isJavaOpen);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                <span
                  style={{
                    transform: isJavaOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.1s",
                    display: "inline-block",
                    marginRight: "4px",
                    fontSize: "10px",
                  }}
                >
                  ▶
                </span>
                Java ({state.deploy.deployFileList.java.length})
              </div>
              {isJavaOpen && (
                <div className="tree-content">
                  {state.deploy.deployFileList.java.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 8px 4px 24px",
                        fontStyle: "italic",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      선택된 파일이 없습니다.
                    </div>
                  ) : (
                    state.deploy.deployFileList.java.map((file, idx) => (
                      <div
                        key={idx}
                        className="tree-item"
                        title={getTooltip(file)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "4px 8px 4px 24px",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {getFileName(file)}
                        </span>
                        {!state.tomcat.running && (
                          <button
                            title={`${getFileName(file)} 제거`}
                            aria-label={`${getFileName(file)} 제거`}
                            className="icon-btn tree-item-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove("java", file);
                            }}
                            style={{
                              width: "20px",
                              height: "20px",
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              padding: 0,
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Query Section */}
            <div className="tree-section">
              <div
                className="tree-header"
                role="button"
                tabIndex={0}
                aria-expanded={isQueryOpen}
                onClick={() => setIsQueryOpen(!isQueryOpen)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsQueryOpen(!isQueryOpen);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                <span
                  style={{
                    transform: isQueryOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.1s",
                    display: "inline-block",
                    marginRight: "4px",
                    fontSize: "10px",
                  }}
                >
                  ▶
                </span>
                Query ({state.deploy.deployFileList.query.length})
              </div>
              {isQueryOpen && (
                <div className="tree-content">
                  {state.deploy.deployFileList.query.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 8px 4px 24px",
                        fontStyle: "italic",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      선택된 파일이 없습니다.
                    </div>
                  ) : (
                    state.deploy.deployFileList.query.map((file, idx) => (
                      <div
                        key={idx}
                        className="tree-item"
                        title={getTooltip(file)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "4px 8px 4px 24px",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {getFileName(file)}
                        </span>
                        {!state.tomcat.running && (
                          <button
                            title={`${getFileName(file)} 제거`}
                            aria-label={`${getFileName(file)} 제거`}
                            className="icon-btn tree-item-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove("query", file);
                            }}
                            style={{
                              width: "20px",
                              height: "20px",
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              padding: 0,
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
