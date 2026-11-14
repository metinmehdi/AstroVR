/**
 * Voice lines (owner: P5). id → text per language. Pre-generated TTS files go to
 * public/audio/{lang}/{id}.mp3 (AI-generated with Gemini TTS, disclosed). If a file is missing, the line is shown as
 * a caption only (no robotic browser voice).
 */
import type { Lang, RadioMessageType } from '../shared/types';

type Lines = Record<string, { en: string; az: string }>;

export const RADIO: Record<RadioMessageType, { en: string; az: string }> = {
  radioCheck: { en: 'AstroVR, this is Mission Control, radio check. How do you read me?', az: 'AstroVR, Missiya İdarəsi danışır. Rabitəni yoxlayırıq, məni necə eşidirsən?' },
  statusRequest: { en: 'AstroVR, Mission Control here. Send us your status.', az: 'AstroVR, Missiya İdarəsi danışır. Vəziyyətini bildir.' },
  returnToBase: { en: 'AstroVR, return to base now.', az: 'AstroVR, dərhal bazaya qayıt.' },
  seekShadow: { en: 'AstroVR, get into the crater shadow, now.', az: 'AstroVR, tez krater kölgəsinə keç.' },
  finishSample: { en: 'AstroVR, finish the sample quickly.', az: 'AstroVR, nümunəni tez bitir.' },
  goodJob: { en: 'Great work, astronaut! Mission Control is proud of you.', az: 'Əla iş, astronavt! Missiya İdarəsi səninlə fəxr edir.' },
  sepWarning: { en: 'AstroVR, solar storm warning! A big flare just erupted on the Sun, and protons are on their way.', az: 'Diqqət, AstroVR! Günəşdə böyük alov püskürdü, günəş fırtınası başlayır. Protonlar yoldadır.' },
  sunBlocked: { en: 'AstroVR, the Sun is so low that a ridge now shades our solar panels. Power is dropping.', az: 'AstroVR, Günəş çox alçaqdadır, silsilə günəş panellərimizi kölgələdi. Enerji azalır.' },
  abort: { en: 'AstroVR, abort the mission. Return safely to base.', az: 'AstroVR, missiya dayandırılır. Təhlükəsiz şəkildə bazaya qayıt.' },
  missionComplete: { en: 'Mission complete. Welcome home, astronaut!', az: 'Missiya tamamlandı. Evə xoş gəldin, astronavt!' },
};

/** Suit computer prompts (not radio: no delay, no beeps). */
export const SUIT: Lines = {
  intro: {
    en: 'This is the south pole of the Moon. The ground below you is real terrain, measured by a NASA laser from lunar orbit.',
    az: 'Bura Ayın cənub qütbüdür. Altındakı yer realdır, NASA-nın Ay orbitindəki lazeri ilə ölçülüb.',
  },
  welcome: {
    en: 'Welcome, astronaut. You are at the south pole of the Moon. Your task: collect a rock sample and come back safely. Look at the glowing light to begin.',
    az: 'Xoş gəldin, astronavt. Sən Ayın cənub qütbündəsən. Tapşırığın: daş nümunəsi toplamaq və təhlükəsiz qayıtmaq. Başlamaq üçün parlayan işığa bax.',
  },
  lookDone: { en: 'Good. Now we check everything before we go outside.', az: 'Əla. İndi çölə çıxmazdan əvvəl hər şeyi yoxlayırıq.' },
  commCheck: { en: 'Radio check. Wait for Mission Control, then answer: Copy.', az: 'Rabitəni yoxlayaq. Missiya İdarəsini gözlə, sonra «Copy» deyə cavab ver.' },
  suitCheck: { en: 'Suit check: oxygen, pressure and dosimeter.', az: 'Skafandrı yoxlayırıq: oksigen, təzyiq və dozimetr.' },
  toolCheck: { en: 'Tool check: camera, scale bar and numbered sample bags.', az: 'Alətləri yoxlayırıq: kamera, miqyas çubuğu və nömrəli nümunə kisələri.' },
  hatchOpen: { en: 'The hatch is open. There is no sound on the Moon. Everything you hear is inside your suit.', az: 'Lyuk açıqdır. Ayda səs yoxdur. Eşitdiyin hər şey skafandrının içindədir.' },
  chooseRoute: { en: 'Choose your route. A is close and sunny. B is far, but the science is better.', az: 'Marşrutunu seç. A yaxındır və günəşlidir. B uzaqdır, amma elmi dəyəri yüksəkdir.' },
  photoFirst: { en: 'Just like the Apollo astronauts: take a photo first, with the scale bar.', az: 'Apollo astronavtları kimi edirik: əvvəlcə miqyas çubuğu ilə şəkil çək.' },
  collected: { en: 'Sample collected.', az: 'Nümunə toplandı.' },
  marked: { en: 'Location saved. Great science!', az: 'Yer qeyd olundu. Əla elmi iş!' },
  stormChoice: { en: 'Storm warning! Decide now: go home, hide in the crater shadow, or keep working.', az: 'Fırtına xəbərdarlığı! İndi qərar ver: evə qayıt, krater kölgəsində gizlən, ya da işə davam et.' },
  protonsArrived: { en: 'Protons are here. Listen to your dosimeter.', az: 'Protonlar gəldi. Dozimetrinə qulaq as.' },
  inShelter: { en: 'You are in the shelter. The walls protect you.', az: 'Sığınacaqdasan. Divarlar səni qoruyur.' },
};

/** Story intro (campaign-style, ~35 s): deep movie-trailer narrator. Facts are real (12 Moon walkers 1969–1972,
 * polar ice in craters unlit for billions of years, the real 11 May 2024 flare). */
export const STORY: Lines = {
  story1: { en: 'For thousands of years, we looked up at the Moon, and dreamed.', az: 'Min illərdir insanlar Aya baxıb xəyal qurub.' },
  story2: {
    en: 'From 1969 to 1972, twelve people walked on it. And then, we stopped.',
    az: '1969-cu ildən 1972-ci ilə qədər on iki insan Ayda gəzdi. Sonra isə dayandıq.',
  },
  story3: {
    en: 'Now we are going back, to the south pole, where ice hides in craters that never see the Sun.',
    az: 'İndi geri qayıdırıq: Ayın cənub qütbünə, Günəş işığı heç düşməyən kraterlərdə buzun gizləndiyi yerə.',
  },
  story4: { en: 'You have trained for years, cadet. Today, it is your turn.', az: 'İllərdir buna hazırlaşırsan, kursant. Bu gün növbə səndədir.' },
  story5: { en: 'But on the Sun, a storm is waking up.', az: 'Amma Günəşdə bir fırtına oyanır.' },
  story6: { en: 'AstroVR. My first Moon mission.', az: 'AstroVR. Mənim ilk Ay missiyam.' },
};

/** Rocket flight (launch control, inside the capsule). */
export const FLIGHT: Lines = {
  countdown: { en: 'Five, four, three, two, one... Liftoff! We have liftoff!', az: 'Beş, dörd, üç, iki, bir... Start! Raket havaya qalxdı!' },
  maxQ: { en: 'Max Q! The air is pushing hardest on the rocket. Hold on tight!', az: 'Maks Q! Hava raketə ən güclü təzyiqi göstərir. Möhkəm otur!' },
  boosterSep: { en: 'The window covers are off! Look, the boosters are separating. This is real footage!', az: 'Pəncərələrin qapağı atıldı! Bax, bustərlər ayrılır. Bunlar real kadrlardır!' },
  meco: { en: 'Main engines off. You are weightless now. Look at the toy!', az: 'Mühərriklər söndü. İndi çəkisizlikdəsən, oyuncağa bax!' },
  sunrise: { en: 'Look ahead: a sunrise from orbit.', az: 'Qarşıya bax: orbitdən Günəşin doğuşu.' },
  transit: {
    en: 'Engine burn to the Moon. Three days and three hundred eighty-four thousand kilometres.',
    az: 'Mühərrik Aya doğru işə düşür. Qarşıda üç günlük yol var: üç yüz səksən dörd min kilometr.',
  },
  earthrise: { en: 'Look! The Earth is rising over the Moon, just like the Apollo 8 crew saw it.', az: 'Bax! Yer Ayın arxasından doğur, eynilə Apollo 8 astronavtlarının gördüyü kimi.' },
  arrival: { en: 'Moon arrival. Starting the descent to the south pole.', az: 'Aya çatdıq. Cənub qütbünə enməyə başlayırıq.' },
  moonikin: {
    en: 'Next to you sits Commander Moonikin Campos. He flew around the Moon on Artemis One.',
    az: 'Yanında Komandir Munikin Kampos oturur. O, Artemis Bir ilə Ayın ətrafına uçub.',
  },
};

export function lineText(table: Lines | typeof RADIO, id: string, lang: Lang): string {
  const l = (table as Lines)[id];
  return l ? l[lang] : id;
}
