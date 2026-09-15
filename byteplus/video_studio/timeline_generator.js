import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const DIVERSE_ANGLES = [
    { id: 'angle_pain_point', name: 'Nỗi đau quá cân & Phạt tiền', focus: 'Đánh thẳng vào nỗi sợ bị phạt tiền hành lý quá cước tại sân bay và vali chật chội' },
    { id: 'angle_capacity_3x', name: 'Gấp 3 lần sức chứa', focus: 'Nhấn mạnh khả năng nén xẹp đồ đạc, nhét trọn cả tủ quần áo vào 1 vali xách tay' },
    { id: 'angle_speed_ease', name: 'Hút chân không siêu tốc 10s', focus: 'Trình diễn tốc độ hút cực nhanh của máy bơm điện mini, chỉ 10 giây là xong' },
    { id: 'angle_before_after', name: 'So sánh Trước vs Sau', focus: 'Tương phản trực quan giữa đống quần áo bừa bộn phồng to và túi nén phẳng lì' },
    { id: 'angle_travel_hack', name: 'Mẹo đóng gói du lịch', focus: 'Bí kíp du lịch thông minh, đi chơi dài ngày không cần mang vác vali cồng kềnh' },
    { id: 'angle_compact_device', name: 'Thiết bị mini bỏ túi', focus: 'Tập trung vào kích thước máy bơm nhỏ gọn trong lòng bàn tay, cổng sạc Type-C tiện lợi' },
    { id: 'angle_airtight_valve', name: 'Khóa van 2 chiều kín khí', focus: 'Độ bền của túi dẻo dai và công nghệ van khóa một chiều chống rò rỉ khí tuyệt đối' },
    { id: 'angle_home_storage', name: 'Tiết kiệm 80% tủ quần áo', focus: 'Ứng dụng bảo quản chăn màn, quần áo mùa đông tại nhà sạch sẽ chống ẩm mốc' },
    { id: 'angle_house_moving', name: 'Chuyển nhà gọn nhẹ', focus: 'Giải pháp cho sinh viên và gia đình dọn nhà, chuyển trọ không còn nỗi lo đồ đạc quá tải' },
    { id: 'angle_smart_savings', name: 'Tiết kiệm chi phí hành lý', focus: 'Tính toán kinh tế: tiết kiệm tiền triệu mua thêm cân hành lý mỗi chuyến bay' },
    { id: 'angle_student_dorm', name: 'Dọn phòng trọ sinh viên', focus: 'Tối ưu phòng trọ chật hẹp, cất chăn gối ga đệm ngăn nắp không chiếm chỗ' },
    { id: 'angle_seasonal_wardrobe', name: 'Đổi mùa cất áo ấm', focus: 'Cất áo phao, áo len cồng kềnh mùa đông gọn gàng, chống ẩm mốc bụi bẩn' },
    { id: 'angle_gift_shopping', name: 'Du lịch tha hồ mua quà', focus: 'Đi chơi thoải mái mua sắm bánh kẹo quà tặng mang về vì vali còn dư nửa chỗ' },
    { id: 'angle_waterproof_protect', name: 'Chống nước & Bụi bẩn', focus: 'Bảo vệ quần áo tối đa khỏi ẩm mốc mùa mưa, côn trùng, và mùi hôi phòng trọ' },
    { id: 'angle_flight_crew_hack', name: 'Mẹo tiếp viên hàng không', focus: 'Bí quyết sắp xếp vali chuyên nghiệp của tiếp viên bay liên tục mỗi tuần' },
    { id: 'angle_backpack_hiking', name: 'Phượt thủ & Trekking', focus: 'Thu gọn ba lô leo núi dã ngoại nhẹ tênh, nhét thêm được túi ngủ và áo khoác' },
    { id: 'angle_emergency_laundry', name: 'Phân loại đồ sạch và dơ', focus: 'Cách ly đồ đã mặc sạch sẽ kín khí khi đi công tác dài ngày' },
    { id: 'angle_heavy_blanket', name: 'Nén chăn bông đại hàn', focus: 'Xử lý chiếc chăn bông to như núi nén ép lại chỉ còn mỏng như quyển sách' },
    { id: 'angle_family_vacation', name: 'Cả nhà du lịch chung 1 vali', focus: 'Gia đình 4 người đi biển chỉ cần 1 vali duy nhất, bố mẹ thảnh thơi dắt con' },
    { id: 'angle_durability_reuse', name: 'Bền bỉ tái sử dụng nhiều năm', focus: 'Chất liệu PA+PE dẻo dai chống rách xước, dùng bền bỉ quanh năm không xì hơi' }
];

function readNineRouterApiKey() {
    try {
        const envPath = path.join(config.root, 'video-analyzer-pipeline', 'video-analyzer-standalone', '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            const match = content.match(/NINE_ROUTER_API_KEY=(.*)/);
            if (match) return match[1].trim();
        }
    } catch (_) {}
    return process.env.NINE_ROUTER_API_KEY || '';
}

/**
 * Pre-flight Semantic Gate: So sánh nhanh từ khóa và ngữ nghĩa của Video Đối thủ
 * với toàn bộ Text mô tả của các clip trong kho.
 * Chạy trong 10-50ms (không tốn token LLM, không quét video).
 */
export function checkSemanticPreflight(referenceAnalysis, libraryAssets) {
    if (!referenceAnalysis) {
        return { canProceed: false, relevanceScore: 0, reason: 'Chưa có dữ liệu phân tích video đối thủ.' };
    }
    const described = (libraryAssets || []).filter(a => a.described && a.descriptionIndex && a.descriptionIndex.length);
    if (described.length === 0) {
        return { canProceed: false, relevanceScore: 0, reason: 'Kho chưa có clip nào được phân tích mô tả nội dung.' };
    }

    // Gom toàn bộ từ vựng phân tích của Reference
    const refTextParts = [
        referenceAnalysis.summary || '',
        referenceAnalysis.purpose || '',
        referenceAnalysis.conclusion || ''
    ];
    if (Array.isArray(referenceAnalysis.visual_events)) {
        for (const ev of referenceAnalysis.visual_events) {
            refTextParts.push(ev.description || '', (ev.objects || []).join(' '), (ev.actions || []).join(' '));
        }
    }
    const refRaw = refTextParts.join(' ').toLowerCase();

    // Tách từ khóa quan trọng (> 3 ký tự)
    const refWords = new Set(refRaw.match(/[\p{L}\p{N}]{3,}/gu) || []);
    if (refWords.size === 0) {
        return { canProceed: true, relevanceScore: 100, reason: 'Đạt chuẩn' };
    }

    // Đếm số clip trong kho có chứa ít nhất 1-2 từ khóa ngữ nghĩa tương đồng
    let matchCount = 0;
    for (const a of described) {
        const assetDesc = [
            a.aiDescription || '',
            JSON.stringify(a.descriptionIndex || [])
        ].join(' ').toLowerCase();

        let hits = 0;
        for (const w of refWords) {
            if (assetDesc.includes(w)) hits++;
        }
        if (hits >= 2) matchCount++;
    }

    const relevanceScore = Math.round((matchCount / described.length) * 100);

    // Nếu độ khớp dưới 5% hoặc số clip khớp < 3 thì coi như lệch chủ đề hoàn toàn
    if (relevanceScore < 5 && matchCount < 3) {
        return {
            canProceed: false,
            relevanceScore,
            matchedClips: matchCount,
            totalClips: described.length,
            reason: `Kho hiện tại (${described.length} clip) chỉ có ${matchCount} clip liên quan đến sản phẩm đối thủ (${relevanceScore}% khớp). Vui lòng nạp thêm clip phù hợp vào kho.`
        };
    }

    return {
        canProceed: true,
        relevanceScore: Math.max(relevanceScore, 70), // Đã có clip khớp chủ đề
        matchedClips: matchCount,
        totalClips: described.length,
        reason: 'Kho đạt chuẩn ngữ nghĩa, sẵn sàng sản xuất.'
    };
}

/**
 * Sinh 1 Production Timeline đơn lẻ theo 1 góc tiếp cận cụ thể.
 */
export async function generateTimeline(referenceAnalysis, libraryAssets, hookAnalysis = null, opts = {}) {
    const {
        angle = null,
        apiKey: explicitKey = null,
        temperature = 0.6,
        angleIndex = 0,
        hookVideoPath = null,
        hookVideoName = null,
        hookType = 'auto'   // 'auto' = model tự chọn hook phù hợp; hoặc user chỉ định 1 hook cụ thể
    } = opts;

    const apiKey = explicitKey || readNineRouterApiKey();

    const describedAssets = (libraryAssets || []).filter(a => a.described);
    const assetList = describedAssets.map(a => ({
        id: a.asset_id,
        duration: a.duration,
        description: a.aiDescription || '',
        events: (a.descriptionIndex || []).slice(0, 3).map(e => ({
            start: e.start,
            end: e.end,
            action: e.description || e.action || ''
        }))
    }));

    const selectedAngle = angle || DIVERSE_ANGLES[0];

    // Chỉ thị hook: user chọn cụ thể -> khoá; 'auto' -> để model tự chọn theo độ PHÙ HỢP.
    const hookDirective = (hookType && hookType !== 'auto')
        ? ('HOOK SELECTION (USER-LOCKED): The user has FIXED the hook type to "' + hookType + '". Segment 1 MUST execute exactly this hook type; still justify how you execute it in directorNote.hookType.')
        : 'HOOK SELECTION (AUTO): Analyze the angle, the product and the reference video, then CHOOSE the ONE hook type from the menu that BEST FITS this specific script (best match to audience, product and reference pacing). Justify the fit in directorNote.hookType. Do not pick randomly and do not default to the same hook every time.';

    const systemPrompt = `You are an elite Direct-Response Short-Form Video Ad Director (TikTok / Reels / YouTube Shorts). Generate ONE complete Production Timeline that assembles clips from an EXISTING stock library into a high-converting short ad whose pacing mirrors a competitor reference video.

LANGUAGE (STRICT): Think and write the ENTIRE script in ENGLISH. Every "text" (on-screen caption) and "voice" (voiceover) field MUST be natural, native-level US English. Never output Vietnamese or any other language.

CREATIVE ANGLE (this drives the whole script — never fall back to a generic template):
- Angle: "${selectedAngle.name}"
- Direction: ${selectedAngle.focus}

=====================================================================
STEP 0 — CHOOSE A COPYWRITING FRAMEWORK that best fits THIS angle, then follow its beat-by-beat logic. Do NOT always use the same framework — pick the one whose emotional logic matches the angle:
- AIDA — Attention -> Interest -> Desire -> Action. Best for broad awareness / cold traffic.
- PAS — Problem -> Agitate -> Solve. Best for pain-point angles; twist the knife before the fix.
- BAB — Before -> After -> Bridge. Best for visual transformation / before-after angles.
- PASTOR — Problem -> Amplify -> Story -> Transformation -> Offer -> Response. Best for story-led, higher-consideration.
- FAB — Feature -> Advantage -> Benefit. Best for spec/feature-heavy demo angles.
- 4Ps — Promise -> Picture -> Proof -> Push. Best when you have a bold claim to back with proof.
- Star-Story-Solution — hero moment -> relatable story -> product as resolution. Best for POV/relatable angles.
- Hook-Retain-Reward — open loop -> keep paying it off -> deliver payoff at CTA. Best for curiosity / retention plays.
Record the chosen framework in directorNote.framework.

=====================================================================
STEP 1 — ${hookDirective}
HOOK TYPE MENU (with definitions — the first 1-3 seconds decide the whole ad):
- problem/pain — open on the viewer's exact frustration.
- shocking-stat — lead with a hard number that stops the scroll.
- bold-claim — a big, confident promise stated flatly.
- negative/warning — "Stop doing X" / "Never buy Y until...".
- curiosity-gap — tease an answer you only reveal later.
- direct-question — ask the viewer a yes-question they nod to.
- POV/relatable — "POV: you're..." lived-in first-person moment.
- before-after-reveal — show the messy before, promise the after.
- pattern-interrupt — an unexpected visual/verbal jolt that breaks the feed.
- social-proof — "Everyone's switching to..." / crowd validation.
- contrarian/myth-vs-fact — bust a belief the audience holds.
- demonstration — start mid-action showing the product working.
- story-cold-open — drop into a mini-story already in motion.
- mistake — "I wasted $X until I learned this".
- price-shock — contrast a painful cost with your cheap fix.
- scarcity — limited stock / limited time urgency up front.
- discovery — "I found this and can't stop using it".
- comment-reply — answer a (real or implied) viewer comment.
- numbered-breakdown — "3 reasons this bag never overweighs".
Record the chosen hook type in directorNote.hookType and justify the fit.

=====================================================================
MANDATORY 4-PHASE STRUCTURE:
1. HOOK (0-3.5s): Execute the chosen hook type. IF A HOOK VIDEO EXISTS, segment 1 MUST use its footage (sourceAssetId: "HOOK_SOURCE"); its text + voice must convey the shock/tension of that hook clip.
2. BRIDGE (3.5-6s): ONE smooth transition line pivoting from the hook's tension to the product as the solution.
3. BODY (6-20s): Demonstrate features / usage / results following the reference video's rhythm, using DIFFERENT library clips per segment.
4. CTA (final ~3s): Close with ONE call to action chosen from the CTA MENU below.

CTA MENU (choose the CTA style that best fits the framework + angle; rotate across generations, never default to the same line):
- urgency — "Grab it before it's gone." time/stock pressure.
- value/offer — "Tap the cart for today's deal." price/bundle led.
- social-proof — "Join thousands who travel lighter." crowd led.
- curiosity — "See why everyone's obsessed." tease the click.
- risk-reversal — "Try it — love it or your money back." kill the risk.
- identity — "For the smart packer in you." aspirational self-image.
- command/direct — "Get yours now." plain imperative.
Record the chosen CTA style in directorNote.ctaStyle.

=====================================================================
TEXT + VOICE SYNC RULES (TikTok/Reels standard, sound-off friendly):
- On-screen "text" MUST match and track the "voice" — never write one thing and say another.
- "text" = the key phrase of the line being spoken, <= 8 words, punchy UPPERCASE keyword style.
- "voice" = 8 to 12 words per segment (never > 14) — crisp, one clear beat, natural breathing room between segments.
- Examples:
  + Voice: "Fined two hundred bucks for an overweight bag at the airport?" -> Text: "FINED $200 FOR AN OVERWEIGHT BAG?"
  + Voice: "This is the one travel hack that saves your whole trip." -> Text: "THE TRAVEL HACK YOU NEED"
  + Voice: "This mini pump flattens all your clothes in ten seconds flat." -> Text: "FLATTENS CLOTHES IN 10 SECONDS"
  + Voice: "Tap the cart and grab today's hot deal right now." -> Text: "GRAB THE HOT DEAL NOW"

LIBRARY CLIP SELECTION (body segments):
- Read each clip's description/events carefully and pick the clip that TRULY matches the action of each segment.
- Every body segment MUST use a different sourceAssetId. Never use the same clip for two adjacent segments.
- Respect 0 <= sourceIn < sourceOut <= the clip's real duration.
- LENGTH: total script 50 to 90 words (about 20-30 seconds).

VARIATION MANDATE (critical): Across different generations for the same product/angle, deliberately vary the framework, the hook type, the emotional tone, the pacing, and the CTA style so no two scripts feel formulaic or identical. Do NOT pick these to avoid a "recently used" list — pick each one because it genuinely FITS this angle, product and reference pacing best. Let the ANGLE lead every creative choice.

=====================================================================
OUTPUT CONTRACT — return a SINGLE valid JSON object. Field types are strict:
{
  "title":        string,            // English video title reflecting the angle
  "directorNote": {
    "framework":        string,      // one framework name from STEP 0
    "hookType":         string,      // one hook type from the STEP 1 menu
    "ctaStyle":         string,      // one CTA style from the CTA MENU
    "hookAngle":        string,      // the 3s hook strategy in one line
    "hookToBodyBridge": string,      // the transition idea from hook -> solution
    "assetRationale":   string       // why these library clips were chosen
  },
  "segments": [                      // array of 4-6 objects, in play order
    {
      "order":         number,       // 1-based sequence index
      "phase":         string,       // one of: "hook" | "bridge" | "body" | "cta"
      "sourceAssetId": string,       // "HOOK_SOURCE" for the hook clip, else a library clip id
      "sourceIn":      number,       // seconds, >= 0
      "sourceOut":     number,       // seconds, > sourceIn, <= clip duration
      "text":          string,       // on-screen caption, <= 8 words, UPPERCASE keyword style
      "voice":         string,       // voiceover line, 8-12 words, natural English
      "transition":    string        // "cut" | "fade" | "zoom" | "slide"
    }
  ]
}

WORKED EXAMPLE (structure reference only — DO NOT copy the wording; write fresh copy for the real angle):
{
  "title": "The $200 Airport Mistake Every Traveler Makes",
  "directorNote": {
    "framework": "PAS",
    "hookType": "price-shock",
    "ctaStyle": "urgency",
    "hookAngle": "Open on the overweight-bag fee to trigger the pain instantly",
    "hookToBodyBridge": "Pivot from the fee shock to the mini pump that flattens everything",
    "assetRationale": "Hook clip shows the airport scale; body clips show pumping, flattening, and the packed suitcase"
  },
  "segments": [
    { "order": 1, "phase": "hook",   "sourceAssetId": "HOOK_SOURCE", "sourceIn": 0,   "sourceOut": 3.5, "text": "FINED $200 FOR AN OVERWEIGHT BAG?", "voice": "Fined two hundred bucks for an overweight bag at the airport?", "transition": "cut" },
    { "order": 2, "phase": "bridge", "sourceAssetId": "vid_pump_01",  "sourceIn": 1.0, "sourceOut": 4.0, "text": "THIS FIXES IT IN SECONDS",         "voice": "Here's the tiny pump that fixes the whole problem fast.",         "transition": "fade" },
    { "order": 3, "phase": "body",   "sourceAssetId": "vid_flat_02",  "sourceIn": 0.5, "sourceOut": 3.5, "text": "FLATTENS CLOTHES IN 10 SECONDS",  "voice": "It flattens a full load of clothes in ten seconds flat.",       "transition": "cut" },
    { "order": 4, "phase": "body",   "sourceAssetId": "vid_case_03",  "sourceIn": 2.0, "sourceOut": 5.0, "text": "A WHOLE WARDROBE, ONE BAG",       "voice": "Now your entire wardrobe fits in one carry-on with room to spare.", "transition": "zoom" },
    { "order": 5, "phase": "cta",    "sourceAssetId": "vid_cta_04",   "sourceIn": 0,   "sourceOut": 3.0, "text": "GRAB TODAY'S DEAL NOW",           "voice": "Tap the cart and grab today's travel deal before it's gone.",     "transition": "cut" }
  ]
}
RETURN VALID JSON ONLY. NO EXPLANATION OUTSIDE THE JSON.`;

    const userPrompt = `Phân tích Video Đối Thủ:
${JSON.stringify({
    summary: referenceAnalysis?.summary || '',
    purpose: referenceAnalysis?.purpose || '',
    visual_events: (referenceAnalysis?.visual_events || []).slice(0, 6)
})}

${hookAnalysis ? `Phân tích Video Hook (Cung cấp các khoảnh khắc giật gân để làm Phân cảnh 1):
${JSON.stringify({
    summary: hookAnalysis.summary || hookAnalysis.purpose || '',
    events: (hookAnalysis.visual_events || []).slice(0, 4)
})}` : ''}

Kho clip có sẵn (${assetList.length} clip):
${JSON.stringify(assetList)}

Hãy tạo Production Timeline với 4 - 6 segment theo góc tiếp cận "${selectedAngle.name}".
Nhớ tuân thủ: Phân cảnh #1 dùng footage từ Video Hook, text overlay bám sát voiceover, và các phân cảnh tiếp theo lấy từ kho clip.`;

    let response;
    try {
        response = await fetch('http://127.0.0.1:20128/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: process.env.NINE_ROUTER_TIMELINE_MODEL || 'ag/gemini-3.8-flash-high',
                stream: false,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature
            })
        });
    } catch (fetchErr) {
        console.warn('Lỗi gọi 9Router LLM, sử dụng kịch bản dự phòng:', fetchErr.message);
    }

    let parsed = null;
    if (response && response.ok) {
        const data = await response.json();
        let rawText = (data.choices && data.choices[0]?.message?.content) ? data.choices[0].message.content.trim() : '';
        if (rawText.startsWith('```json')) {
            rawText = rawText.substring(7);
            if (rawText.endsWith('```')) rawText = rawText.substring(0, rawText.length - 3);
        } else if (rawText.startsWith('```')) {
            rawText = rawText.substring(3);
            if (rawText.endsWith('```')) rawText = rawText.substring(0, rawText.length - 3);
        }
        try { parsed = JSON.parse(rawText.trim()); } catch (_) {}
    }

    // Fallback thông minh nếu LLM lỗi mạng hoặc parse thất bại
    if (!parsed) {
        const sampleAssets = describedAssets.slice(0, 5);
        parsed = {
            title: selectedAngle.name,
            directorNote: {
                hookAngle: selectedAngle.focus,
                hookToBodyBridge: 'Chuyển từ sự cố vali kẹt sang giải pháp túi nén',
                assetRationale: 'Dùng footage hook thật mở màn, kết hợp clip tính năng trong kho'
            },
            segments: [
                {
                    order: 1,
                    phase: 'hook',
                    sourceAssetId: hookVideoPath ? 'HOOK_SOURCE' : (sampleAssets[0]?.asset_id || 'VID_HOOK'),
                    sourceIn: 0,
                    sourceOut: 3.5,
                    text: 'BỊ PHẠT TIỀN VÌ VALI QUÁ CÂN?',
                    voice: 'Đi sân bay bị phạt tiền triệu vì vali quá khổ quá cân?',
                    transition: 'cut'
                },
                ...sampleAssets.slice(1).map((a, idx) => ({
                    order: idx + 2,
                    phase: idx === sampleAssets.length - 2 ? 'cta' : (idx === 0 ? 'bridge' : 'body'),
                    sourceAssetId: a.asset_id,
                    sourceIn: 0,
                    sourceOut: Math.min(3.5, a.duration || 3.5),
                    text: idx === 0 ? 'GIẢI PHÁP THU GỌN VALI GẤP 3' : (idx === sampleAssets.length - 2 ? 'SĂN DEAL HÔM NAY' : `BƯỚC ${idx}: THAO TÁC CỰC NHANH`),
                    voice: idx === 0 ? 'Đừng lo, giải pháp thu gọn vali gấp ba lần chính là đây!' : (idx === sampleAssets.length - 2 ? 'Bấm giỏ hàng săn deal combo du lịch ngay!' : 'Chỉ cần một thao tác là túi phẳng lì ngăn nắp.'),
                    transition: 'fade'
                }))
            ]
        };
    }

    let segments = [];
    let directorNote = {
        hookAngle: selectedAngle.focus,
        hookToBodyBridge: 'Chuyển từ nỗi đau sang giải pháp',
        assetRationale: 'Bốc clip kho theo phân cảnh hành động'
    };
    let title = selectedAngle.name;

    if (Array.isArray(parsed)) {
        segments = parsed;
    } else if (parsed && Array.isArray(parsed.segments)) {
        segments = parsed.segments;
        directorNote = parsed.directorNote || directorNote;
        title = parsed.title || title;
    }

    return {
        title,
        angle: selectedAngle,
        directorNote,
        segments
    };
}

/**
 * Thuật toán Quy hoạch Biến thể Tổ hợp (Combinatorial Variant Planning Engine):
 * 1. Hook Segment: Cắt trực tiếp phân cảnh cao trào từ Video Hook
 * 2. Greedy Least-Used Selection cho các clip thân bài
 * 3. Max Usage per Variant (U <= 3) - ÉP CỨNG LOẠI BỎ CLIP VƯỢT NGƯỠNG
 * 4. Anti-Adjacent Enforce (|index_i - index_j| >= 2)
 * 5. Head Randomizer (0-15s) cho clip kho
 * 6. 70% Inventory Coverage Gate
 */
export function applyCombinatorialPlanning(rawTimeline, libraryAssets, globalUsage = {}, maxUsageU = 3, hookContext = {}) {
    const validAssets = (libraryAssets || []).filter(a => a.described);
    const assetMap = new Map(validAssets.map(a => [a.asset_id, a]));
    const segments = (rawTimeline.segments || []).slice();

    let matchedValidCount = 0;
    const missingSegments = [];

    const hookVideoPath = hookContext.hookVideoPath || null;
    const hookVideoName = hookContext.hookVideoName || (hookVideoPath ? path.basename(hookVideoPath) : null);
    const hookAnalysis = hookContext.hookAnalysis || null;
    const hookEvents = (hookAnalysis && (hookAnalysis.visual_events || hookAnalysis.events)) || [];
    const variantIndex = (rawTimeline.index || rawTimeline.angleIndex || 1) - 1;

    // Tìm các candidate clips theo semantic text
    for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        const isHookSegment = (idx === 0 || seg.phase === 'hook');

        // NẾU LÀ PHÂN CẢNH 1 VÀ CÓ VIDEO HOOK: BẮT BUỘC CẮT TỪ VIDEO HOOK
        if (isHookSegment && hookVideoPath && fs.existsSync(hookVideoPath)) {
            seg.phase = 'hook';
            seg.sourceAssetId = 'HOOK_SOURCE';
            seg.assetPath = hookVideoPath;
            seg.assetFilename = hookVideoName || path.basename(hookVideoPath);

            let hookStart = 0;
            let hookEnd = 3.5;

            if (hookEvents.length > 0) {
                // Chia đều các visual events ấn tượng từ video hook cho các biến thể
                const evIdx = variantIndex % hookEvents.length;
                const ev = hookEvents[evIdx];
                if (ev && typeof ev.start === 'number' && typeof ev.end === 'number' && ev.end > ev.start) {
                    hookStart = ev.start;
                    hookEnd = Math.min(ev.end, hookStart + 4.0);
                }
            } else if (typeof seg.sourceIn === 'number' && typeof seg.sourceOut === 'number' && seg.sourceOut > seg.sourceIn) {
                hookStart = seg.sourceIn;
                hookEnd = seg.sourceOut;
            }

            // Jitter nhỏ theo biến thể để tránh trùng khớp từng khung hình
            const jitter = Math.round(((variantIndex * 0.2) % 1.0) * 10) / 10;
            seg.sourceIn = Math.max(0, hookStart + jitter);
            seg.sourceOut = Math.max(seg.sourceIn + 1.5, hookEnd + jitter);
            matchedValidCount++;
            continue;
        }

        // CÁC PHÂN CẢNH THÂN BÀI TỪ KHO
        let targetAsset = assetMap.get(seg.sourceAssetId);

        // KHÓA CỨNG U <= 3: Nếu targetAsset đã dùng >= maxUsageU lần, BẮT BUỘC tráo clip khác!
        const curUsage = targetAsset ? (globalUsage[targetAsset.asset_id] || 0) : 0;
        if (targetAsset && curUsage < maxUsageU) {
            matchedValidCount++;
        } else {
            const candidates = validAssets.filter(a => {
                const u = globalUsage[a.asset_id] || 0;
                return u < maxUsageU;
            });

            if (candidates.length > 0) {
                // Sắp xếp chọn clip ít dùng nhất (Greedy Least-Used Selection)
                candidates.sort((a, b) => (globalUsage[a.asset_id] || 0) - (globalUsage[b.asset_id] || 0));
                const minU = globalUsage[candidates[0].asset_id] || 0;
                const bestPool = candidates.filter(a => (globalUsage[a.asset_id] || 0) === minU);
                targetAsset = bestPool[Math.floor(Math.random() * bestPool.length)];
                seg.sourceAssetId = targetAsset.asset_id;
                matchedValidCount++;
            } else {
                missingSegments.push(`Phân cảnh #${idx + 1} (${seg.phase || 'body'})`);
            }
        }

        if (targetAsset) {
            const clipDur = Number(targetAsset.duration) || 5;
            const segDur = Math.max(1.5, Math.min(3.5, (seg.sourceOut && seg.sourceIn) ? (Number(seg.sourceOut) - Number(seg.sourceIn)) : 3.0));

            // HEAD RANDOMIZER: Cắt ngẫu nhiên đầu clip 0-15s độc lập cho từng video
            const maxOffset = Math.max(0, clipDur - segDur);
            const headOffset = Math.round(Math.random() * Math.min(15, maxOffset) * 10) / 10;

            seg.sourceIn = headOffset;
            seg.sourceOut = Math.min(clipDur, headOffset + segDur);
            seg.assetPath = targetAsset.path;
            seg.assetFilename = targetAsset.filename;
            globalUsage[targetAsset.asset_id] = (globalUsage[targetAsset.asset_id] || 0) + 1;
        }
    }

    // Anti-Adjacent Check: Đảm bảo không có 2 phân cảnh liền kề dùng cùng 1 asset
    for (let i = 0; i < segments.length - 1; i++) {
        if (segments[i].sourceAssetId && segments[i].sourceAssetId === segments[i + 1].sourceAssetId) {
            const altCandidates = validAssets.filter(a => 
                a.asset_id !== segments[i].sourceAssetId && 
                (globalUsage[a.asset_id] || 0) < maxUsageU
            );
            if (altCandidates.length > 0) {
                const alt = altCandidates[Math.floor(Math.random() * altCandidates.length)];
                segments[i + 1].sourceAssetId = alt.asset_id;
                segments[i + 1].sourceIn = 0;
                segments[i + 1].sourceOut = Math.min(3.5, alt.duration);
                segments[i + 1].assetPath = alt.path;
                segments[i + 1].assetFilename = alt.filename;
                globalUsage[alt.asset_id] = (globalUsage[alt.asset_id] || 0) + 1;
            }
        }
    }

    const coverageRate = segments.length > 0 ? Math.round((matchedValidCount / segments.length) * 100) : 0;
    const isValid = coverageRate >= 70;

    return {
        title: rawTimeline.title || 'Video Biến Thể',
        angle: rawTimeline.angle,
        directorNote: rawTimeline.directorNote,
        segments,
        coverageRate,
        isValid,
        validationError: isValid ? null : `Kho chỉ đáp ứng ${coverageRate}% (thiếu: ${missingSegments.join(', ')})`
    };
}

/**
 * Sinh đồng thời 10 kịch bản song song (Batch LLM Generation).
 */
export async function generateBatchTimelines(referenceAnalysis, libraryAssets, hookAnalysis = null, requestedCount = 10, hookContext = {}) {
    const count = Math.max(1, Math.min(requestedCount, 20));
    const apiKey = readNineRouterApiKey();

    const anglesToUse = DIVERSE_ANGLES.slice(0, count);
    while (anglesToUse.length < count) {
        anglesToUse.push({
            id: `angle_extra_${anglesToUse.length + 1}`,
            name: `Biến thể tiếp cận #${anglesToUse.length + 1}`,
            focus: 'Góc tiếp cận bổ sung độc lập'
        });
    }

    const batchUsage = {};
    for (const a of libraryAssets) {
        if (a.usage_count) batchUsage[a.asset_id] = a.usage_count;
    }

    const promises = anglesToUse.map((angle, idx) => {
        return generateTimeline(referenceAnalysis, libraryAssets, hookAnalysis, {
            angle,
            apiKey,
            temperature: 0.5 + (idx * 0.04),
            angleIndex: idx,
            hookVideoPath: hookContext.hookVideoPath || null,
            hookVideoName: hookContext.hookVideoName || null,
            hookType: hookContext.hookType || 'auto'
        }).catch(err => {
            console.error(`[BatchTimeline] Lỗi sinh kịch bản #${idx + 1}:`, err);
            return null;
        });
    });

    const rawResults = await Promise.all(promises);

    const finalizedTimelines = [];
    for (let i = 0; i < rawResults.length; i++) {
        const raw = rawResults[i];
        if (!raw || !raw.segments || raw.segments.length === 0) {
            finalizedTimelines.push({
                index: i + 1,
                title: anglesToUse[i].name,
                angle: anglesToUse[i],
                isValid: false,
                coverageRate: 0,
                validationError: 'Không thể sinh kịch bản từ LLM',
                segments: []
            });
            continue;
        }

        const planned = applyCombinatorialPlanning(
            { index: i + 1, angleIndex: i, ...raw },
            libraryAssets,
            batchUsage,
            3,
            hookContext
        );
        finalizedTimelines.push({
            index: i + 1,
            ...planned
        });
    }

    return finalizedTimelines;
}
