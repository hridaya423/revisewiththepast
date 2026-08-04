export type TopicId = string;

export type TopicTreeNode = {
  id: TopicId;
  label: string;
  leafTopicIds: TopicId[];
  children?: TopicTreeNode[];
};

export type TopicTreeNodeWithCounts = Omit<TopicTreeNode, "children"> & {
  questionUnitCount: number;
  children?: TopicTreeNodeWithCounts[];
};
