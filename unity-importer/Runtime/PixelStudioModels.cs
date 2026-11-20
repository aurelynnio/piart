using System;
using System.Collections.Generic;
using UnityEngine;

namespace AIPixelStudio.Runtime
{
    [Serializable]
    public class StateFlagEntry
    {
        public string flagId;
        public string key;
        public string type;
        public string defaultValueJson;
        public string description;
    }

    [Serializable]
    public class DialogueNodeEntry
    {
        public string nodeId;
        public string kind;
        public string speakerAssetId;
        public string speakerName;
        public string text;
    }

    [Serializable]
    public class DialogueEdgeEntry
    {
        public string edgeId;
        public string fromNodeId;
        public string toNodeId;
        public string label;
    }

    [Serializable]
    public class DialogueGraphEntry
    {
        public string dialogueId;
        public string assetId;
        public string name;
        public string npcAssetId;
        public string startNodeId;
        public List<DialogueNodeEntry> nodes = new List<DialogueNodeEntry>();
        public List<DialogueEdgeEntry> edges = new List<DialogueEdgeEntry>();
    }

    [Serializable]
    public class QuestRewardEntry
    {
        public string itemAssetId;
        public string itemKey;
        public int quantity;
    }

    [Serializable]
    public class QuestDefinitionEntry
    {
        public string questId;
        public string assetId;
        public string name;
        public string description;
        public string giverNpcAssetId;
        public string completionFlagKey;
        public List<QuestRewardEntry> rewards = new List<QuestRewardEntry>();
    }

    [Serializable]
    public class GameplayBundlePayload
    {
        public string stableId;
        public List<StateFlagEntry> stateFlags = new List<StateFlagEntry>();
        public List<DialogueGraphEntry> dialogues = new List<DialogueGraphEntry>();
        public List<QuestDefinitionEntry> quests = new List<QuestDefinitionEntry>();
    }
}
