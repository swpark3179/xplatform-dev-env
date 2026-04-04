import { useState } from 'react';
import { UxServiceEntry, UxStudioEnvConfig } from '../../types';

const BASE_PREFIX_IDS = ['lib', 'Images', 'CSS', 'WORK', 'comm', 'composite', 'frame', 'frame_sgips', 'cmc'];
const SAMPLE_PREFIX_IDS = ['guide', 'Sample', 'xchart', 'DESIGN', 'UX_DESIGN', 'UX_CRM', 'UX_MES', 'UX_GUIDE_Component', 'UX_GUIDE_Templates', 'UX_GUIDE_Objects'];
const ALL_RESERVED_IDS = new Set([...BASE_PREFIX_IDS, ...SAMPLE_PREFIX_IDS]);

interface Props {
    services: UxServiceEntry[];
    onApply: (config: UxStudioEnvConfig) => void;
}

const UxStudioSetupPanel: React.FC<Props> = ({ services, onApply }) => {
    const [includeBase, setIncludeBase] = useState(true);
    const [includeSample, setIncludeSample] = useState(false);
    const [urlAutoCorrect, setUrlAutoCorrect] = useState(true);

    // 커스텀 체크박스 대상: 기본/샘플 제외, url이 ./로 시작하는 것
    const customServices = services.filter(
        s => !ALL_RESERVED_IDS.has(s.prefixid) && s.url.startsWith('./')
    );

    const [checkedPrefixIds, setCheckedPrefixIds] = useState<Set<string>>(new Set());

    const toggleCustom = (prefixid: string) => {
        setCheckedPrefixIds(prev => {
            const next = new Set(prev);
            if (next.has(prefixid)) next.delete(prefixid);
            else next.add(prefixid);
            return next;
        });
    };

    const handleApply = () => {
        const config: UxStudioEnvConfig = {
            includeBase,
            includeSample,
            customPrefixIds: Array.from(checkedPrefixIds),
            urlAutoCorrect,
        };
        onApply(config);
    };

    return (
        <div className="ux-setup-panel">
            <div className="ux-setup-panel__title">초기 환경 설정</div>
            <p className="ux-setup-panel__desc">
                포함할 Service 항목을 선택하고 '설정 적용'을 클릭하세요.
            </p>

            {/* 기본파일 포함 */}
            <label className="ux-setup-panel__check-row">
                <input
                    type="checkbox"
                    checked={includeBase}
                    onChange={e => setIncludeBase(e.target.checked)}
                    id="ux-include-base"
                />
                <span>기본파일 포함</span>
                <span className="ux-setup-panel__check-hint">
                    ({BASE_PREFIX_IDS.filter(id => services.some(s => s.prefixid === id)).join(', ')})
                </span>
            </label>

            {/* 샘플파일 포함 */}
            <label className="ux-setup-panel__check-row">
                <input
                    type="checkbox"
                    checked={includeSample}
                    onChange={e => setIncludeSample(e.target.checked)}
                    id="ux-include-sample"
                />
                <span>샘플파일 포함</span>
                <span className="ux-setup-panel__check-hint">
                    ({SAMPLE_PREFIX_IDS.filter(id => services.some(s => s.prefixid === id)).join(', ')})
                </span>
            </label>

            {/* 커스텀 Service 체크박스 목록 */}
            {customServices.length > 0 && (
                <div className="ux-setup-panel__custom-list-wrapper">
                    <div className="ux-setup-panel__custom-list-label">커스텀 Service 항목</div>
                    <div className="ux-setup-panel__custom-list">
                        {customServices.map(svc => (
                            <label key={svc.prefixid} className="ux-setup-panel__check-row ux-setup-panel__check-row--custom">
                                <input
                                    type="checkbox"
                                    checked={checkedPrefixIds.has(svc.prefixid)}
                                    onChange={() => toggleCustom(svc.prefixid)}
                                    id={`ux-custom-${svc.prefixid}`}
                                />
                                <span className="ux-setup-panel__prefixid">{svc.prefixid}</span>
                                <span className="ux-setup-panel__url">{svc.url}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {/* url 자동보정 */}
            <label className="ux-setup-panel__check-row ux-setup-panel__check-row--autocorrect">
                <input
                    type="checkbox"
                    checked={urlAutoCorrect}
                    onChange={e => setUrlAutoCorrect(e.target.checked)}
                    id="ux-url-autocorrect"
                />
                <span>url 자동보정</span>
                <span className="ux-setup-panel__check-hint">
                    (localhost:7001/ep/ → 60.101.107.57:8002/ep/)
                </span>
            </label>

            {/* 설정 적용 버튼 */}
            <button className="ux-setup-panel__apply-btn" onClick={handleApply}>
                설정 적용
            </button>
        </div>
    );
};

export default UxStudioSetupPanel;
