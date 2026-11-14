/**
 * Voice lines (owner: P5). id → text per language. Pre-generated TTS files go to
 * public/audio/{lang}/{id}.mp3 (AI-generated, disclosed). If a file is missing, the browser voice reads the text.
 */
import type { Lang, RadioMessageType } from '../shared/types';

type Lines = Record<string, { en: string; az: string }>;

export const RADIO: Record<RadioMessageType, { en: string; az: string }> = {
  radioCheck: { en: 'AstroVR, this is Mission Control. Radio check. How do you read?', az: 'AstroVR, burası Missiya İdarəsi. Rabitə yoxlaması. Məni eşidirsən?' },
  statusRequest: { en: 'Mission Control. Send us your status.', az: 'Missiya İdarəsi. Vəziyyətini bildir.' },
  returnToBase: { en: 'Mission Control. Return to base now.', az: 'Missiya İdarəsi. Dərhal bazaya qayıt.' },
  seekShadow: { en: 'Mission Control. Get into the crater shadow.', az: 'Missiya İdarəsi. Krater kölgəsinə keç.' },
  finishSample: { en: 'Mission Control. Finish the sample, quickly.', az: 'Missiya İdarəsi. Nümunəni tez bitir.' },
  goodJob: { en: 'Mission Control. Great work, astronaut.', az: 'Missiya İdarəsi. Əla iş, astronavt.' },
  sepWarning: { en: 'Mission Control. Solar storm warning. A big flare on the Sun. Protons are coming.', az: 'Missiya İdarəsi. Günəş fırtınası xəbərdarlığı. Günəşdə böyük alov. Protonlar gəlir.' },
  sunBlocked: { en: 'Mission Control. The Sun went behind the ridge. Our solar power is dropping.', az: 'Missiya İdarəsi. Günəş silsilənin arxasına keçdi. Günəş enerjimiz azalır.' },
  abort: { en: 'Mission Control. Abort. Abort. Safe return to base.', az: 'Missiya İdarəsi. Missiya dayandırılır. Təhlükəsiz qayıdış.' },
  missionComplete: { en: 'Mission Control. Mission complete. Welcome home, astronaut.', az: 'Missiya İdarəsi. Missiya tamamlandı. Xoş gəldin, astronavt.' },
};

/** Suit computer prompts (not radio: no delay, no beeps). */
export const SUIT: Lines = {
  welcome: {
    en: 'Welcome, astronaut. You are at the south pole of the Moon. Your task: collect a rock sample and come back safely. Look at the glowing light to begin.',
    az: 'Xoş gəldin, astronavt. Sən Ayın cənub qütbündəsən. Tapşırığın: daş nümunəsi toplamaq və təhlükəsiz qayıtmaq. Başlamaq üçün parlayan işığa bax.',
  },
  lookDone: { en: 'Good. Now we check everything before we go outside.', az: 'Əla. İndi çölə çıxmazdan əvvəl hər şeyi yoxlayırıq.' },
  commCheck: { en: 'Radio check. Wait for Mission Control and answer: Copy.', az: 'Rabitə yoxlaması. Missiya İdarəsini gözlə və cavab ver: Copy.' },
  suitCheck: { en: 'Suit check: oxygen, pressure, dosimeter.', az: 'Skafandr yoxlaması: oksigen, təzyiq, dozimetr.' },
  toolCheck: { en: 'Tool check: camera, scale bar, numbered sample bags.', az: 'Alət yoxlaması: kamera, miqyas çubuğu, nömrəli kisələr.' },
  hatchOpen: { en: 'The hatch is open. There is no sound on the Moon. Everything you hear is inside your suit.', az: 'Lyuk açıqdır. Ayda səs yoxdur. Eşitdiyin hər şey skafandrının içindədir.' },
  chooseRoute: { en: 'Choose your route. A is close and sunny. B is far, but the science is better.', az: 'Marşrutunu seç. A yaxındır və günəşlidir. B uzaqdır, amma elmi dəyəri yüksəkdir.' },
  photoFirst: { en: 'Like Apollo astronauts: photo first, with the scale bar.', az: 'Apollo astronavtları kimi: əvvəl foto, miqyas çubuğu ilə.' },
  collected: { en: 'Sample collected.', az: 'Nümunə toplandı.' },
  marked: { en: 'Location saved. Great science!', az: 'Yer qeyd olundu. Əla elm!' },
  stormChoice: { en: 'Storm warning! Decide now: go home, hide in the crater shadow, or keep working.', az: 'Fırtına xəbərdarlığı! İndi qərar ver: evə qayıt, krater kölgəsində gizlən, ya da işə davam et.' },
  protonsArrived: { en: 'Protons are here. Listen to your dosimeter.', az: 'Protonlar gəldi. Dozimetrinə qulaq as.' },
  inShelter: { en: 'You are in the shelter. The walls protect you.', az: 'Sığınacaqdasan. Divarlar səni qoruyur.' },
};

export function lineText(table: Lines | typeof RADIO, id: string, lang: Lang): string {
  const l = (table as Lines)[id];
  return l ? l[lang] : id;
}
