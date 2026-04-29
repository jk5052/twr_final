import type { Defense } from '@/data/defenses'

export type Tag = 'AV' | 'EX' | 'CG' | 'SP' | 'AD'

export interface DefenseCandidate {
  defense: Defense
  weight: number              // 0~1, 한 choice 내 합 ≈ 1
}

// Harrison 2015 차원 — optional. 후속 batch 라벨링으로 채움.
export interface ScenarioFactor {
  dangerousness?: number      // 0~1
  escapability?: number       // 0~1
  interpersonal?: boolean
  physical?: boolean          // physical(true) / psychological(false)
}

export interface Choice {
  label: string
  tag: Tag                                // 거친 5-tag (UX 카테고리)
  defenses: DefenseCandidate[]            // RAG1 Method A/B 가중 vote 입력
  postNarration?: string                  // 선택 후 잠깐 표시되는 추가 서사
  endChain?: boolean                      // true면 이 선택 후 chain 즉시 종료
  cardId?: string                         // 카드 시스템 — 추후 채움
}

export interface ObjectEvent {
  text: string
  choices: Choice[]
  scenario?: ScenarioFactor
}

// 한 오브젝트의 sequential events (한 클릭으로 array 전체가 한 호흡에 흐름).
// chain 도중 ESC: 그때까지의 선택은 살리고 + cancellation +1.
// 회피 선택지는 endChain: true로 chain 조기 종료.
export interface ItemSchema {
  itemId: string                          // GLB mesh name
  room: number
  kind: 'regular' | 'door' | 'cctv'       // door: 3슬롯/skip, cctv: 자동 시점 복귀
  events: ObjectEvent[]
  oneTimeOnly?: boolean                   // R4 doors 등 — 첫 chain 종료 후 잠금
}

// defenses 배열은 룸 spec 일괄 수집 후 Claude로 자동 라벨링 예정.
export const ITEMS: ItemSchema[] = [
  // ─── Room 1 ───────────────────────────────────────────────
  {
    itemId: 'room01_tv',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: 'The TV is on.',
        choices: [
          { label: "A documentary I don't recognize. Someone is being interviewed. I can't read the subtitles.", tag: 'CG', defenses: [] },
          { label: 'A commercial. The same one keeps looping.',                                                  tag: 'AV', defenses: [] },
          { label: 'A cartoon I used to love as a kid.',                                                         tag: 'AD', defenses: [] },
          { label: 'The screen is full of static. If I get closer, a shape might come through.',                 tag: 'EX', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'calendar',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: 'A calendar hangs on the wall.',
        choices: [
          { label: "Still last year's calendar. No one ever flipped it.", tag: 'AV', defenses: [] },
          { label: 'A date is circled. What was the appointment?',         tag: 'CG', defenses: [] },
          { label: 'Nothing written anywhere. A blank calendar.',          tag: 'AV', defenses: [] },
          { label: "Today's date is marked with an X.",                    tag: 'EX', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'room01_box',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: "A box? What's inside?",
        choices: [
          { label: 'Things I used as a child. Familiar.',         tag: 'AD', defenses: [] },
          { label: 'Belongings of someone I barely know. Who is this?', tag: 'CG', defenses: [] },
          { label: "Nothing. It's empty.",                         tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'cellphone',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: "I picked up the phone.\nThere's a message waiting.",
        choices: [
          { label: 'A message from a friend, full of resentment.',                  tag: 'EX', defenses: [] },
          { label: 'An unknown number. "Why did you do that?"',                     tag: 'SP', defenses: [] },
          { label: 'Mom. "How are you?"',                                           tag: 'AD', defenses: [] },
          { label: "Someone I haven't seen in a long time. \"...you know, back then...\"", tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'room01_fan',
    room: 1,
    kind: 'regular',
    events: [
      {
        text:
          'A vent? Wait — I think I hear something!\n' +
          'I press my ear close — someone is talking.\n' +
          'As I pass through the hallway, two people are talking inside a room. The door is half-open.\n' +
          'Person A: "...they probably won\'t know."\n' +
          'Person B: "Maybe that\'s for the best."\n' +
          'What are they talking about?',
        choices: [
          { label: 'Is this about me? What is it? What are they hiding?',                tag: 'SP', defenses: [] },
          { label: 'Probably has nothing to do with me — but who are they talking about?', tag: 'CG', defenses: [] },
          { label: "Not enough information to tell.",                                    tag: 'CG', defenses: [] },
          { label: "I shouldn't have listened.",                                         tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'candle',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: 'I touched it and the candle lit up. What scent is this?',
        choices: [
          { label: "The scent of my grandmother's house.",                          tag: 'AD', defenses: [] },
          { label: 'The scent of the first person I ever liked.',                   tag: 'AD', defenses: [] },
          { label: "I don't know. It's nice, but I can't remember where I smelled it.", tag: 'AV', defenses: [] },
          { label: "Artificial. This doesn't feel real.",                           tag: 'CG', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'room01_diary',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: 'A diary? I open it.',
        choices: [
          { label: 'Read from the beginning.',           tag: 'EX', defenses: [] },
          { label: 'Skip to the last page.',             tag: 'EX', defenses: [] },
          { label: 'Open it at random.',                 tag: 'EX', defenses: [] },
          { label: 'Close it. Better not to look.',      tag: 'AV', defenses: [], endChain: true },
        ],
      },
      {
        text: 'Something is written.',
        choices: [
          { label: 'The handwriting has faded — hard to read.',     tag: 'CG', defenses: [] },
          { label: 'Only one line: "Nothing happened today."',      tag: 'AV', defenses: [] },
          { label: 'A page has been torn out. Who took it?',        tag: 'SP', defenses: [] },
          { label: "It's my handwriting, but I don't remember writing it.", tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'room01_pictureframe',
    room: 1,
    kind: 'regular',
    events: [
      {
        text: 'A family photo? But someone seems to be missing. Who is missing?',
        choices: [
          { label: 'Missing? Looks complete to me.',                         tag: 'AV', defenses: [] },
          { label: "Someone should be there, but I can't tell where.",       tag: 'CG', defenses: [] },
          { label: "They're standing outside the frame.",                    tag: 'SP', defenses: [] },
          { label: 'The one holding the camera?',                            tag: 'CG', defenses: [] },
        ],
      },
      {
        text: "Suddenly there's an empty space in the photo. I have to step in. Where do I stand?",
        choices: [
          { label: 'Center.',                       tag: 'AD', defenses: [] },
          { label: 'Next to a particular person.',  tag: 'AD', defenses: [] },
          { label: 'At the edge.',                  tag: 'AV', defenses: [] },
          { label: "I don't want to step in...",    tag: 'AV', defenses: [] },
        ],
      },
    ],
  },

  // ─── Room 2 — 복도 1 ──────────────────────────────────────
  {
    itemId: 'classboard',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: "Someone's name is written on it.",
        choices: [
          { label: 'Erase it.',                              tag: 'EX', defenses: [] },
          { label: 'Write my name next to it.',              tag: 'EX', defenses: [] },
          { label: 'Leave it as it is.',                     tag: 'AV', defenses: [] },
          { label: 'Look closely to see what it says.',      tag: 'CG', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'pinboard',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'Sheets of paper are pinned to the board.',
        choices: [
          { label: "An event poster. I don't think I went.",           tag: 'AV', defenses: [] },
          { label: "A notice with someone's name. Were we close?",     tag: 'CG', defenses: [] },
          { label: 'A warning notice. What happened?',                  tag: 'EX', defenses: [] },
          { label: 'A very old sheet. No one ever took it down.',       tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'schoolbus',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'A school bus is here. What to do?',
        choices: [
          {
            label: 'Run and hop on.',
            tag: 'EX',
            defenses: [],
            postNarration: "...damn. Got fooled. It isn't moving...",
          },
          { label: "Someone is waving me over, but I pretend not to see.", tag: 'AV', defenses: [] },
          { label: 'Just watch. Curious where the bus is going.',          tag: 'CG', defenses: [] },
          { label: 'Already too late. Wait for the next one.',             tag: 'AD', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'man',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'Someone is standing at the end of the hallway. A man. Who is he?',
        choices: [
          { label: "He doesn't seem to have seen me. I walk closer.",   tag: 'EX', defenses: [] },
          { label: 'He seems to have seen me. I stop.',                  tag: 'AV', defenses: [] },
          { label: "I can't tell if he sees me or not. I stay still.",  tag: 'AV', defenses: [] },
          { label: 'I feel like I know who he is without looking. I walk past.', tag: 'AD', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'high_school_desk',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'A school desk? Here?',
        choices: [
          { label: 'Looks exactly like the one I sat at as a kid. I sit down.', tag: 'AD', defenses: [] },
          { label: 'Look inside the desk to see what it holds.',                 tag: 'EX', defenses: [] },
          { label: "Something is carved on the desktop. I read it.",             tag: 'CG', defenses: [] },
          { label: 'Walk past.',                                                  tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'cabient',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'A cabinet.',
        choices: [
          { label: 'Empty cabinet. Only a name tag remains.',           tag: 'AV', defenses: [] },
          { label: 'A single sheet of paper inside. Someone left it.',  tag: 'CG', defenses: [] },
          { label: "The door won't close. Something seems caught.",     tag: 'SP', defenses: [] },
          { label: 'Locked. I shake it, trying to force it open.',      tag: 'EX', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'mirror1',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'I stand in front of the mirror. Something familiar is reflected.',
        choices: [
          { label: "The living room from childhood. Someone's back.", tag: 'AD', defenses: [] },
          { label: 'A school bathroom. Alone.',                        tag: 'AV', defenses: [] },
          { label: 'The moment someone took my picture.',              tag: 'AD', defenses: [] },
          { label: "I can't tell. It's blurry.",                       tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'mirror2',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'The mirror is slightly cracked. My reflection looks split.',
        choices: [
          { label: "There are two of me. One is smiling, the other isn't.", tag: 'SP', defenses: [] },
          { label: 'One side is me as a child, the other is me now.',        tag: 'CG', defenses: [] },
          { label: "The reflected face doesn't feel like mine.",             tag: 'SP', defenses: [] },
          { label: 'I only look at the cracked part. I avoid the rest.',     tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'mirror3',
    room: 2,
    kind: 'regular',
    events: [
      {
        text: 'The mirror is foggy, hard to see. I have to step closer.',
        choices: [
          { label: 'I wipe it. My hand touches the mirror.',          tag: 'EX', defenses: [] },
          { label: 'I watch from a distance, leaving it blurred.',    tag: 'AV', defenses: [] },
          { label: 'The reflection looks like someone else.',         tag: 'SP', defenses: [] },
          { label: 'The mirror grows even more clouded. I step away.', tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'cctv',
    room: 2,
    kind: 'cctv',
    events: [
      {
        text:
          "View shift: a black-and-white CCTV feed. Someone's point of view.\n" +
          "Someone is watching the hallway I'm standing in!\n" +
          'But wait...\n' +
          'My eyes meet yours on the screen.\n' +
          'The me on the screen — grins at the camera.\n' +
          'And starts walking closer?',
        choices: [
          { label: 'Turn off the screen.',                                  tag: 'AV', defenses: [] },
          { label: 'Stare back. See how close it gets.',                    tag: 'EX', defenses: [] },
          { label: "Run. Who knows what's behind me.",                      tag: 'AV', defenses: [] },
          { label: "Turn toward the camera. To see if I'm really visible there.", tag: 'CG', defenses: [] },
        ],
      },
    ],
  },

  // ─── Room 3 ───────────────────────────────────────────────
  {
    itemId: 'DisplayCaseExport',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'A glass display case. Empty. Did someone take everything? Or was it always empty?',
        choices: [
          { label: 'It seems it was empty from the start.', tag: 'AV', defenses: [] },
          { label: 'Someone took everything, it seems.',     tag: 'EX', defenses: [] },
          { label: 'It will be filled soon.',                tag: 'AD', defenses: [] },
          { label: 'It will stay empty forever.',            tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'banquet chair WITH COVER',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: "Event hall chairs and tables. What's the atmosphere here?",
        choices: [
          { label: 'Packed. No empty seats. I stand.',                        tag: 'AV', defenses: [] },
          { label: 'One seat is open. Someone is sitting next to it.',        tag: 'EX', defenses: [] },
          { label: 'Empty. Hard to decide where to sit.',                     tag: 'CG', defenses: [] },
          { label: "Seats are assigned. Where's mine?",                       tag: 'AD', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'tall_speaker_2',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'An announcement comes through the speaker.\nThis way, please!',
        choices: [
          { label: 'Go in the direction it points.',                            tag: 'AD', defenses: [] },
          { label: 'Really? Pause and check if others are heading that way too.', tag: 'CG', defenses: [] },
          { label: 'Ignore the announcement. Look for another path.',           tag: 'AV', defenses: [] },
          { label: "Look at the speaker — who's talking?",                      tag: 'EX', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'Electric door key',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'A keypad lock. What does this open? It needs a code.',
        choices: [
          { label: 'Try a familiar number (a birthday, an anniversary).', tag: 'AD', defenses: [] },
          { label: "Try 0000. Maybe nobody changed it.",                  tag: 'EX', defenses: [] },
          { label: 'Someone might be watching. Cover the keypad as I press.', tag: 'SP', defenses: [] },
          { label: "I don't know the code. Find another way.",            tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'trophy',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'A trophy sits on the desk.',
        choices: [
          { label: 'Check the name.',                  tag: 'CG', defenses: [] },
          { label: 'Is it mine? I touch it.',          tag: 'EX', defenses: [] },
          { label: 'Not my business.',                 tag: 'AV', defenses: [] },
          { label: 'Move it. The placement feels off.', tag: 'AD', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'microphone',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'A microphone stand. The red light is on. The mic is live.',
        choices: [
          { label: 'Step closer.',                                                          tag: 'EX', defenses: [] },
          { label: "Don't go close. If I say the wrong thing, something might happen.",     tag: 'AV', defenses: [] },
          { label: 'Someone left it on. Turn it off.',                                       tag: 'AD', defenses: [] },
          { label: 'Bring my hand close — see if it picks anything up.',                     tag: 'CG', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'winner_podium',
    room: 3,
    kind: 'regular',
    events: [
      {
        text: 'On the podium. The ceremony is about to start. I have to decide where to stand, fast.',
        choices: [
          { label: 'Step onto the 1st-place spot.',          tag: 'EX', defenses: [] },
          { label: 'Step onto the 3rd-place spot.',          tag: 'AD', defenses: [] },
          { label: 'Stand beside the podium.',               tag: 'AV', defenses: [] },
          { label: 'Wait until someone comes to tell me.',   tag: 'AV', defenses: [] },
        ],
      },
      {
        text: "The path to the podium. The floor seems to be moving. Each platform moves on its own. As if it's a race to see who arrives first.",
        choices: [
          { label: 'Step onto the fast-moving platform.',                tag: 'EX', defenses: [] },
          { label: 'Step onto the slow-moving platform.',                tag: 'AD', defenses: [] },
          { label: 'Stand balanced between two platforms.',              tag: 'CG', defenses: [] },
          { label: 'Notice the next person has a faster platform.',      tag: 'SP', defenses: [] },
        ],
      },
      {
        text: "I stand beside the podium. Someone is watching me. What's their expression?",
        choices: [
          { label: 'Looking with envy.',     tag: 'SP', defenses: [] },
          { label: 'Sneering.',              tag: 'SP', defenses: [] },
          { label: 'Indifferent.',           tag: 'AV', defenses: [] },
          { label: 'Not paying attention.',  tag: 'AD', defenses: [] },
        ],
      },
    ],
  },

  // ─── Room 4 — 엘리베이터 ───────────────────────────────────
  // 5개 포스터: 클릭 자체가 곧 선택. 각 1-event 1-choice.
  {
    itemId: 'poster_art',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'An art poster. Abstract. Vivid colors.',
        choices: [
          { label: 'Take this elevator.', tag: 'AD', defenses: [], postNarration: '...I step toward the elevator.' },
        ],
      },
    ],
  },
  {
    itemId: 'poster_family',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'A family photo poster. A warm atmosphere.',
        choices: [
          { label: 'Take this elevator.', tag: 'AD', defenses: [], postNarration: '...I step toward the elevator.' },
        ],
      },
    ],
  },
  {
    itemId: 'poster_psychology',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'A psychology lecture poster. A brain and diagrams.',
        choices: [
          { label: 'Take this elevator.', tag: 'CG', defenses: [], postNarration: '...I step toward the elevator.' },
        ],
      },
    ],
  },
  {
    itemId: 'poster_comic',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'A comic poster. Exaggerated characters laughing.',
        choices: [
          { label: 'Take this elevator.', tag: 'AV', defenses: [], postNarration: '...I step toward the elevator.' },
        ],
      },
    ],
  },
  {
    itemId: 'poster_relation',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'A poster of people holding hands. Something about relationships.',
        choices: [
          { label: 'Take this elevator.', tag: 'EX', defenses: [], postNarration: '...I step toward the elevator.' },
        ],
      },
    ],
  },
  // 엘리베이터 본체: 버튼 → 3-doors → 머물기/이동 → 승객 → 멈춤 게임 → 작별 선물
  {
    itemId: 'modern_apartment_elevator',
    room: 4,
    kind: 'regular',
    events: [
      {
        text: 'I stand in front of the elevator. Press the button. No response.',
        choices: [
          { label: 'Press it again.',                                                       tag: 'EX', defenses: [] },
          { label: 'Wait a moment.',                                                        tag: 'AD', defenses: [] },
          { label: 'Look for another elevator.',                                            tag: 'AV', defenses: [] },
          { label: "There's an 'Out of Order' sign next to it. Press it one more time anyway.", tag: 'SP', defenses: [] },
        ],
      },
      {
        text:
          'Finally the elevator opens! But behind the doors are three more doors..?\n' +
          '🚪 A: The sound of people laughing.\n🚪 B: Silence. Only the occasional bird call.\n🚪 C: Someone is playing piano. The melody is sad.\nWhich door will you open?',
        choices: [
          {
            label: 'A: The sound of people laughing.',
            tag: 'EX',
            defenses: [],
            postNarration: '...there are people, but they go quiet when I step in.',
          },
          {
            label: 'B: Silence. Only the occasional bird call.',
            tag: 'AV',
            defenses: [],
            postNarration: '...the room is empty, but my photo hangs on the wall.',
          },
          {
            label: 'C: The sad piano melody.',
            tag: 'SP',
            defenses: [],
            postNarration: "...there's a piano, but no one is playing. The keys move on their own.",
          },
        ],
      },
      {
        text: 'Will you stay in this room, or open another door?',
        choices: [
          { label: 'Stay.',              tag: 'AD', defenses: [] },
          { label: 'Open another door.', tag: 'AV', defenses: [] },
        ],
      },
      {
        text: "The door opens and finally the elevator interior appears. Whew.. I'm finally on the elevator.\nBut... I'm not alone? There are people. The other passengers glance at each other.",
        choices: [
          { label: 'Look for the emergency button. Where it is.', tag: 'SP', defenses: [] },
          { label: 'Watch the others. Read their faces.',         tag: 'EX', defenses: [] },
          { label: "Just stand still. It'll start moving soon.",  tag: 'AV', defenses: [] },
          { label: "Pull out my phone. See if there's a signal.", tag: 'AV', defenses: [] },
        ],
      },
      {
        text: 'The elevator, which seemed to be going up, suddenly thudded to a stop! An announcement begins.\nWe will now play a game. That game is..',
        choices: [
          { label: 'Rock-paper-scissors.',                          tag: 'AD', defenses: [] },
          { label: 'Everyone sing together. Each takes a verse.',   tag: 'EX', defenses: [] },
          { label: 'Pick a random game.',                            tag: 'CG', defenses: [] },
          { label: "Ignore it.. I'd rather be alone.",              tag: 'AV', defenses: [] },
        ],
      },
      {
        text: 'The game is over! The elevator finally seems to be moving up.\nAs I step out, one of the others hands me something.',
        choices: [
          { label: 'An envelope. Light.',                              tag: 'CG', defenses: [] },
          { label: 'A small box. Heavy.',                              tag: 'EX', defenses: [] },
          { label: "A single sheet of paper. Hard to read what it says.", tag: 'SP', defenses: [] },
          { label: "They open their palm to show me — there's nothing.", tag: 'AV', defenses: [] },
        ],
      },
    ],
  },

  // ─── Room 5 — 마지막 방 ───────────────────────────────────
  {
    itemId: 'statue',
    room: 5,
    kind: 'regular',
    events: [
      {
        text:
          'A sculpture of a kissing couple. Up close — their faces are slightly apart.\n' +
          "It's ambiguous whether it's just before or just after the kiss.",
        choices: [
          { label: 'See it as just before. The moment of getting closer.',  tag: 'AD', defenses: [] },
          { label: 'See it as just after. The moment of pulling apart.',    tag: 'AV', defenses: [] },
          { label: 'See them as frozen. Stuck in that place.',              tag: 'CG', defenses: [] },
          { label: "Can't tell. Look away.",                                 tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'coushion',
    room: 5,
    kind: 'regular',
    events: [
      {
        text: 'A cushion on the floor.',
        choices: [
          { label: 'Push it aside.',  tag: 'AV', defenses: [] },
          { label: 'Sit on it.',      tag: 'AD', defenses: [] },
          { label: 'Leave it alone.', tag: 'AV', defenses: [] },
        ],
      },
    ],
  },
  // table_chair = 편지 아이템 (이름은 mesh명이라 그대로 유지).
  // e1: 벽 사진 5장 중 하나 가져가기 → e2: 편지 쓰기 prompt.
  {
    itemId: 'table_chair',
    room: 5,
    kind: 'regular',
    events: [
      {
        text: 'Five photographs hang on the wall. I can take one.',
        choices: [
          { label: '① A photo of people laughing together. Their faces are blurred.', tag: 'AD', defenses: [] },
          { label: '② An empty room. Light comes through the window.',                tag: 'AV', defenses: [] },
          { label: '③ The sea. The sky just before a storm.',                         tag: 'SP', defenses: [] },
          { label: "④ A child looking back. Their expression isn't visible.",         tag: 'AV', defenses: [] },
          { label: '⑤ Take nothing.',                                                  tag: 'AV', defenses: [] },
        ],
      },
      {
        text:
          'A blank sheet and a pen on the table. It feels like I should write a letter.\n' +
          "I'm about to write. About what?",
        choices: [
          { label: 'The words you should have said.', tag: 'EX', defenses: [] },
          { label: 'The words you never heard.',      tag: 'SP', defenses: [] },
          { label: "Words you'll never say again.",   tag: 'AV', defenses: [] },
          { label: "Words you haven't said yet.",     tag: 'AD', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'coat_rack',
    room: 5,
    kind: 'regular',
    events: [
      {
        text: 'A coat rack by the entrance. Empty. What to do with my coat.',
        choices: [
          { label: 'Hang it up.',                              tag: 'AD', defenses: [] },
          { label: 'Keep holding it.',                         tag: 'AV', defenses: [] },
          { label: 'Drape it over the back of a chair.',       tag: 'CG', defenses: [] },
          { label: 'Toss it on the floor.',                    tag: 'EX', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'bag',
    room: 5,
    kind: 'regular',
    events: [
      {
        text: "A bag sits beside a chair. It doesn't seem to be mine.",
        choices: [
          { label: "Check whose it is. Maybe there's a clue inside.", tag: 'EX', defenses: [] },
          { label: 'Leave it. Someone will come looking for it.',     tag: 'AV', defenses: [] },
          { label: 'Move it aside, out of the way.',                  tag: 'AD', defenses: [] },
          { label: 'Touch the bag. It feels somehow familiar.',       tag: 'SP', defenses: [] },
        ],
      },
    ],
  },
  {
    itemId: 'furniture_pack',
    room: 5,
    kind: 'regular',
    events: [
      {
        text: 'Three chairs in the room. Where to sit?',
        choices: [
          { label: 'The chair facing the window. Look straight at the view.',   tag: 'EX', defenses: [] },
          { label: 'The middle chair at the table. Between two seats.',          tag: 'AD', defenses: [] },
          { label: 'The chair near the entrance. Easy to leave fast.',           tag: 'AV', defenses: [] },
          { label: "Don't sit. Stand for a while.",                              tag: 'AV', defenses: [] },
        ],
      },
      {
        text: 'I sat down. On the chair across from me — traces of someone who was there.',
        choices: [
          { label: 'The chair is pulled out slightly. Someone got up and left.',  tag: 'CG', defenses: [] },
          { label: "A coat is on the chair. Looks like someone's coming back.",   tag: 'AD', defenses: [] },
          { label: 'A bag strap is hooked on the chair leg. Saving the seat, it seems.', tag: 'CG', defenses: [] },
          { label: 'The chair is pushed in neatly. Looks like no one ever sat there.',   tag: 'AV', defenses: [] },
        ],
      },
      {
        text: 'Time has passed. Should I get up?',
        choices: [
          { label: 'Stand up. Leave.',                                            tag: 'AD', defenses: [] },
          { label: "My body shifts a little. But I don't get up yet.",            tag: 'AV', defenses: [] },
          { label: "Stay seated. I could leave, but I don't.",                    tag: 'AV', defenses: [] },
          { label: "Wait for the other to disappear. I won't be the one to leave first.", tag: 'SP', defenses: [] },
        ],
      },
    ],
  },

  // ─── Exit doors (kind:'door') — chain 없이 클릭 시 JournalingOverlay 트리거.
  // GLB mesh 가 있는 방만 등록. 그 외 방은 좌상단 "next room" 버튼이 동일 역할.
  { itemId: 'room01_door', room: 1, kind: 'door', events: [] },
  { itemId: 'door',        room: 2, kind: 'door', events: [] },
  { itemId: 'big door',    room: 3, kind: 'door', events: [] },
  { itemId: 'Door',        room: 5, kind: 'door', events: [] },
]

export const ITEM_BY_NAME: Record<string, ItemSchema> = Object.fromEntries(
  ITEMS.map((i) => [i.itemId, i])
)

// 방 진입 시 RoomIntro(눈 깜빡임) 종료 후 자동 발화되는 chain.
// 아이템에 묶이지 않으며, item chain과 동일한 ObjectEvent 모양을 따른다.
// gameStore Choice에는 itemId = ENTRY_ITEM_ID로 기록.
export const ENTRY_ITEM_ID = '__entry__'

export const ROOM_ENTRY_EVENTS: Record<number, ObjectEvent[]> = {
  1: [
    {
      text: "What... where am I? Where is this?",
      choices: [
        {
          label: 'Go to the door first, jiggle it, see if I can get out.',
          tag: 'EX',
          defenses: [],
          postNarration: '...nothing happened.',
        },
        {
          label: 'Walk around the room, touching the walls.',
          tag: 'EX',
          defenses: [],
          postNarration: '...nothing happened.',
        },
        {
          label: "Check what's on the table.",
          tag: 'EX',
          defenses: [],
          postNarration: '...nothing happened.',
        },
        {
          label: "What is this... let me not move for now. Sit on the sofa.",
          tag: 'AV',
          defenses: [],
          cardId: 'TBD_room01_sofa', // 카드 시스템 추후 — 획득 애니메이션 연결
        },
      ],
    },
  ],
  3: [
    // event 1: 창문 풍경 선택 — 선택지에 따라 창밖 이미지가 바뀜 (시각 처리 후속).
    {
      text: "Where is this..? I can't quite see out the window..\nLook at the view outside.",
      choices: [
        { label: 'Mountains and rivers. Nature.', tag: 'AD', defenses: [] },
        { label: 'A forest of buildings.',         tag: 'CG', defenses: [] },
        { label: 'A window painted over black.',   tag: 'AV', defenses: [] },
        { label: 'An empty white landscape.',      tag: 'AV', defenses: [] },
        { label: 'A sky thick with fog.',          tag: 'SP', defenses: [] },
      ],
    },
    // event 2: 행사장 안. 사람들이 있다.
    {
      text: 'Inside the event hall. People are here. What first?',
      choices: [
        { label: 'Strike up a conversation with someone.', tag: 'EX', defenses: [] },
        { label: 'Grab some food.',                        tag: 'AV', defenses: [] },
        { label: 'Look for the host.',                     tag: 'CG', defenses: [] },
        { label: 'Walk around, scanning the mood.',        tag: 'SP', defenses: [] },
      ],
    },
  ],
  4: [
    // event 1: 복도 조명 선택.
    {
      text: "I've entered a hallway. It's blurry. Something seems to be ahead.\nThe lighting hits differently in different places.",
      choices: [
        { label: 'Head toward the bright light.',    tag: 'EX', defenses: [] },
        { label: 'Head toward the dark side.',       tag: 'AV', defenses: [] },
        { label: 'Head toward the colored light.',   tag: 'EX', defenses: [] },
        { label: 'Head toward the flickering light.', tag: 'SP', defenses: [] },
      ],
    },
    // event 2: 엘리베이터·포스터 framing — 단일 continue 선택지.
    {
      text:
        "An elevator?\nWait — there's something on each elevator.\n" +
        'In front of five elevators, each has a different poster. Should I pick one and ride it..?',
      choices: [
        { label: 'Look at the posters.', tag: 'EX', defenses: [] },
      ],
    },
  ],
  5: [
    // event 1: 방 분위기 5지선다 — 선택지에 따라 방 분위기/창 풍경 결정 (시각 처리 후속).
    {
      text: "Where am I.. again?\nI can't quite see out the window..",
      choices: [
        { label: 'A café. Small tables. Outside, a rainy street.',                       tag: 'AD', defenses: [] },
        { label: "Someone's living room. The furniture feels familiar. Outside, a forest of buildings.", tag: 'AD', defenses: [] },
        { label: 'A hotel room. Clean. Outside, an empty white landscape.',              tag: 'AV', defenses: [] },
        { label: 'A kitchen with a dining table. Warm light. Outside, mountains and a river.', tag: 'AD', defenses: [] },
        { label: "A room I don't recognize. The window is thick with fog.",              tag: 'SP', defenses: [] },
      ],
    },
  ],
}

export const ROOM_MODELS: Record<number, string> = {
  1: '/models/r1.glb',
  2: '/models/r2.glb',
  3: '/models/r3.glb',
  4: '/models/r4.glb',
  5: '/models/r5.glb',
}

// 'conversation' phase 의 백그라운드 — Void 흰 공간 (LLM 대화 단계).
export const FINAL_MODEL = '/models/finalroom.glb'

// 방 진입 시 1인칭 인트로 (눈 깜박임 + 생각). 끝나면 ROOM_ENTRY_EVENTS chain이 이어짐.
export const ROOM_INTROS: Record<number, string> = {
  1: "What... where am I?",
  2: "Where am I now... a hallway...?",
  3: "Where is this..? I can't quite see out the window..",
  4: "I've entered a hallway. It's blurry.",
  5: "Where am I.. again?",
}
