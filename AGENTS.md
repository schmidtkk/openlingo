When the user asks you something, follow a 2 step Plan & Implement (PI) pattern.

All the files generated during PI should be saved into a new folder inside /agent-docs named "DD-MMM-YYYY-description-of-thing-to-implement". If the user provided a task.md file, move also into this folder. If there is no task.md file provided, create it and add the user's initial prompt inside it.

PI pattern:

1. Deeply research the codebase based on what the user asked you. Go deep into functions and code, analyse everything in great details going through everything and understanding the intricacies. Once you have all the information, write the implementation plan at a file called `plan.md`. This should include relevant information discovered during research, design decisions taken and edge cases or other things we should pay close attention to. Include a todo list at the end that describes step by step how you are going to perform this. After this, ask the user for review. Do not implement yet.
2. Once you get approval from the user, implement everything following `plan.md`, do not ask for user input anymore.