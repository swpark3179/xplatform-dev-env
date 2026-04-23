import { useAppState } from './hooks/useAppState';
import SettingsPage from './pages/SettingsPage';
import MainPage from './pages/MainPage';
import ProjectSettingsPage from './pages/ProjectSettingsPage';
import UxStudioPage from './pages/UxStudioPage';
import { useEffect } from 'react';

function App() {
    const { state, actions } = useAppState();

    useEffect(() => {
        actions.settings.initProject();
    }, []);

    if (!state.validation.isFirstLoaded) {
        return (
            <div className="app loading-state">
                <div className="loading-spinner" aria-hidden="true" />
                <span className="loading-text">로딩 중...</span>
            </div>
        );
    }

    const renderPage = () => {
        switch (state.navigation.currentPage) {
            case 'main':
                return <MainPage state={state} actions={actions} />;
            case 'project-settings':
                return <ProjectSettingsPage actions={actions} />;
            case 'ux-studio':
                return <UxStudioPage state={state} actions={actions} />;
            case 'settings':
            default:
                return <SettingsPage state={state} actions={actions} />;
        }
    };

    return (
        <div className="app">
            <div style={{ padding: '4px 8px', fontSize: '11px', background: 'rgba(255,255,0,0.2)', color: '#888', borderBottom: '1px solid #444', marginBottom: '8px' }}>
                [DEBUG] page={state.navigation.currentPage}, loaded={String(state.validation.isFirstLoaded)}, allValid={String(state.validation.allValid)}, projectValid={String(state.validation.projectValid)}
            </div>
            {renderPage()}
        </div>
    );
}

export default App;
