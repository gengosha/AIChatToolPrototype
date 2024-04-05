import { v4 as uuidv4 } from "uuid";
import { Message } from "./Message";
import { streamCompletion } from "./OpenAI";
import { getChatById, updateChatMessages } from "./utils";
import { notifications } from "@mantine/notifications";
import { getModelInfo } from "./Model";
import { useChatStore } from "./ChatStore";

const get = useChatStore.getState;
const set = useChatStore.setState;

export const abortCurrentRequest = () => {
  const currentAbortController = get().currentAbortController;
  if (currentAbortController?.abort) currentAbortController?.abort();
  set((state) => ({
    apiState: "idle",
    currentAbortController: undefined,
  }));
};

export const submitMessage = async (message: Message) => {
  // If message is empty, do nothing
  if (message.content.trim() === "") {
    console.error("Message is empty");
    return;
  }

  const activeChatId = get().activeChatId;
  const chat = get().chats.find((c) => c.id === activeChatId!);
  if (chat === undefined) {
    console.error("Chat not found");
    return;
  }
  console.log("chat", chat.id);

  // If this is an existing message, remove all the messages after it
  const index = chat.messages.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    set((state) => ({
      chats: state.chats.map((c) => {
        if (c.id === chat.id) {
          c.messages = c.messages.slice(0, index);
        }
        return c;
      }),
    }));
  }

  // Add the message
  set((state) => ({
    apiState: "loading",
    chats: state.chats.map((c) => {
      if (c.id === chat.id) {
        c.messages.push(message);
      }
      return c;
    }),
  }));

  const assistantMsgId = uuidv4();
  // Add the assistant's response
  set((state) => ({
    chats: state.chats.map((c) => {
      if (c.id === state.activeChatId) {
        c.messages.push({
          id: assistantMsgId,
          content: "",
          role: "assistant",
          loading: true,
        });
      }
      return c;
    }),
  }));

  const apiKey = get().apiKey;
  if (apiKey === undefined) {
    console.error("API key not set");
    return;
  }

  const updateTokens = (promptTokensUsed: number, completionTokensUsed: number) => {
    const activeModel = get().settingsForm.model;
    const {prompt: promptCost, completion: completionCost} = getModelInfo(activeModel).costPer1kTokens;
    set((state) => ({
      apiState: "idle",
      chats: state.chats.map((c) => {
        if (c.id === chat.id) {
          c.promptTokensUsed = (c.promptTokensUsed || 0) + promptTokensUsed;
          c.completionTokensUsed = (c.completionTokensUsed || 0) + completionTokensUsed;
          c.costIncurred =
            (c.costIncurred || 0) + (promptTokensUsed / 1000) * promptCost + (completionTokensUsed / 1000) * completionCost;
        }
        return c;
      }),
    }));
  };
  const settings = get().settingsForm;

  const abortController = new AbortController();
  set((state) => ({
    currentAbortController: abortController,
    ttsID: assistantMsgId,
    ttsText: "",
  }));

  // ASSISTANT REQUEST
  await streamCompletion(
    chat.messages,
    settings,
    apiKey,
    abortController,
    (content) => {
      set((state) => ({
        ttsText: (state.ttsText || "") + content,
        chats: updateChatMessages(state.chats, chat.id, (messages) => {
          const assistantMessage = messages.find(
            (m) => m.id === assistantMsgId
          );
          if (assistantMessage) {
            assistantMessage.content += content;
          }
          return messages;
        }),
      }));
    },
    async (promptTokensUsed, completionTokensUsed) => {
      set((state) => ({
        apiState: "idle",
        chats: updateChatMessages(state.chats, chat.id, (messages) => {
          const assistantMessage = messages.find(
            (m) => m.id === assistantMsgId
          );
          if (assistantMessage) {
            assistantMessage.loading = false;
          }
          return messages;
        }),
      }));
      updateTokens(promptTokensUsed, completionTokensUsed);
      await findPicture().then(() => {console.log("LATEST_MESSAGE: ", get().chats.slice(-1)[0].latestMessage)});
      if (get().settingsForm.auto_title) {
        findChatTitle();
      }
    },
    (errorRes, errorBody) => {
      let message = errorBody;
      try {
        message = JSON.parse(errorBody).error.message;
      } catch (e) {}

      notifications.show({
        message: message,
        color: "red",
      });
      // Run abortCurrentRequest to remove the loading indicator
      abortCurrentRequest();
    }
  );

  const findPicture = async () => {
    const chat = getChatById(get().chats, get().activeChatId);
    if (chat === undefined) {
      console.error("Chat not found");
      return;
    }

    const msg = {
      id: uuidv4(),
      content: `以下の感情パラメーターの場合、今から提示する説明でどれが最も正しいかを一つのみ選択してください。回答は半角数字で行ってください。
      形式は以下です。
      { select: number }
      
      選択肢：
      1.  ​満面の笑み​ - 喜びと楽しさが最高潮に達した状態。
      2.  ​胸を張って自信気​ - 自信満々でポジティブなオーラを放つ。
      3.  ​涙を流して泣いている​ - 悲しみや喪失感で涙を流す。
      4.  ​怒りを露にして​ - 激怒し、怒りが顔に表れる。
      5.  ​不安げな顔​ - 恐怖や不安で顔が曇り、落ち着かない様子。
      6.  ​好奇心旺盛​ - 新しいことに対する期待やワクワクを感じる。
      7.  ​失望感​ - 期待が裏切られた時のガッカリ感。
      8.  ​ワクワクしている​ - 楽しいことが起こる予想で心が躍る。
      9.  ​照れ笑い​ - 恥ずかしさや甘酸っぱさからくる笑顔。
      10. ​静かな自信​ - 落ち着いた態度で内面の自信を見せる。
      11. ​心が躍っている​ - 興奮や興味が高まる瞬間。
      12. ​達成感​ - 目標や課題をクリアしたときの満足感。
      13. ​絶望している​ - 希望が見出せず、心が折れそうな状態。
      14. ​疑問に思っている​ - 何かが分からず、考え込む様子。
      15. ​愛情深く見つめる​ - 深い愛情や好意を込めた眼差し。
      16. ​不信感を抱いている​ - 信用できない、疑念を持っている表情。
      17. ​恐怖に凍えている​ - 恐怖で身動きがとれず、青ざめる。
      18. ​挑戦する意欲​ - 新たな目標や困難に立ち向かおうとする決意。
      19. ​冷静な態度​ - 動じない態度で、落ち着き払っている。`,
      role: "system",
    } as Message;

    let isFirstMessage = true;
    let latestMessage = "";

    await streamCompletion(
      [msg, ...chat.messages.slice(-1)],
      settings,
      apiKey,
      undefined,
      (content) => {
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id === chat.id) {
              if (isFirstMessage) {
                chat.latestMessage = "";
                latestMessage = "";
              } else {
                chat.latestMessage = (chat.latestMessage || "") + content;
                latestMessage = (chat.latestMessage || "") + content;
              }
            }
            return c;
          }),
        }));
        console.log("latestMessage: ", latestMessage);
        isFirstMessage = false;
      },
      updateTokens
    );
  }

  const findChatTitle = async () => {
    const chat = getChatById(get().chats, get().activeChatId);
    if (chat === undefined) {
      console.error("Chat not found");
      return;
    }
    // Find a good title for the chat
    const numWords = chat.messages
      .map((m) => m.content.split(" ").length)
      .reduce((a, b) => a + b, 0);
    if (
      chat.messages.length >= 2 &&
      chat.title === undefined &&
      numWords >= 4
    ) {
      const msg = {
        id: uuidv4(),
        content: `Describe the following conversation snippet in 3 words or less.
              >>>
              Hello
              ${chat.messages
                .slice(1)
                .map((m) => m.content)
                .join("\n")}
              >>>
                `,
        role: "system",
      } as Message;

      await streamCompletion(
        [msg, ...chat.messages.slice(1)],
        settings,
        apiKey,
        undefined,
        (content) => {
          set((state) => ({
            chats: state.chats.map((c) => {
              if (c.id === chat.id) {
                // Find message with id
                chat.title = (chat.title || "") + content;
                if (chat.title.toLowerCase().startsWith("title:")) {
                  chat.title = chat.title.slice(6).trim();
                }
                // Remove trailing punctuation
                chat.title = chat.title.replace(/[,.;:!?]$/, "");
              }
              return c;
            }),
          }));
        },
        updateTokens
      );
    }
  };
};
