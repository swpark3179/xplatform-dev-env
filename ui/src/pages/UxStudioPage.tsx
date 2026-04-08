import { useEffect, useState } from "react";
import { AppActions, AppState } from "@/hooks/useAppState";
import UxStudioSetupPanel from "../components/ux-studio/UxStudioSetupPanel";
import UxStudioFilePanel from "../components/ux-studio/UxStudioFilePanel";
import UxStudioLaunchPanel from "../components/ux-studio/UxStudioLaunchPanel";
import { Modal } from "../components/common/Modal";

const UxStudioPage: React.FC<{ state: AppState; actions: AppActions }> = ({
  state,
  actions,
}) => {
  const { status, services, xfdlFiles, xprjFiles } = state.uxStudio;
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // 패널 진입 시 초기화 요청
  useEffect(() => {
    actions.uxStudio.init();
  }, []);

  const handleResetSetupClick = () => {
    setIsResetModalOpen(true);
  };

  const handleResetConfirm = () => {
    setIsResetModalOpen(false);
    actions.uxStudio.resetSetup();
  };

  const handleResetCancel = () => {
    setIsResetModalOpen(false);
  };

  return (
    <div className="ux-studio-page">
      {/* 상단 헤더 */}
      <div className="ux-studio-page__header">
        <button
          className="ux-studio-page__back-btn"
          onClick={actions.navigation.goToMain}
        >
          ← 메인으로
        </button>
        <span className="ux-studio-page__title">UX Studio 관리</span>
        {status === "configured" && (
          <button
            className="ux-studio-page__reset-btn"
            onClick={handleResetSetupClick}
            title="설정을 초기화하고 처음부터 다시 설정합니다"
          >
            설정 초기화
          </button>
        )}
      </div>

      {isResetModalOpen && (
        <Modal
          isOpen={true}
          title="설정 초기화"
          onClose={handleResetCancel}
          onConfirm={handleResetConfirm}
          confirmText="예"
          cancelText="아니오"
        >
          설정을 초기화하면 현재 설정 정보가 삭제됩니다. 계속하시겠습니까?
        </Modal>
      )}

      {/* 본문 */}
      <div className="ux-studio-page__body">
        {status === null ? (
          <div className="ux-studio-page__loading">
            <div className="loading-spinner" aria-hidden="true" />
            <span>초기화 중...</span>
          </div>
        ) : status === "new" ? (
          <UxStudioSetupPanel
            services={services}
            onApply={(config) => actions.uxStudio.applySettings(config)}
          />
        ) : (
          <>
            {state.uxStudio.envConfig?.mode === 'selected' && (
              <UxStudioFilePanel
                xfdlFiles={xfdlFiles}
                confirmErrorFiles={state.uxStudio.confirmErrorFiles || []}
                initialSelectedFiles={state.uxStudio.envConfig.selectedFiles || []}
                onRefresh={() => actions.uxStudio.searchXfdl()}
                onConfirm={(selected) => actions.uxStudio.confirmFiles(selected)}
                onClearConfirmError={() => actions.uxStudio.clearConfirmError()}
              />
            )}
            <UxStudioLaunchPanel
              xprjFiles={xprjFiles}
              onLaunch={(filePath) => actions.uxStudio.launchXprj(filePath)}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default UxStudioPage;
